// Kiểm thử phiếu sự cố người thuê gửi chủ trọ, trên máy chủ thật (SQLite dùng chung).
// Chạy: npm run test:su-co
// Mục 1-14: mô phỏng người thuê bằng fetch API trực tiếp, chủ trọ bằng trình duyệt thật trên
// quan-ly/nguoi-thue.html (kiểm cả 3 lối vào drawer, chỉ báo trong dòng người thuê, chuông thông báo).
// Mục 15-17: tai-khoan/ho-tro.html (trang thật, đã nối API /api/su-co*) bằng trình duyệt thật —
// xem docs/su-co-nguoi-thue.md.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const PORT = 5598;
const B = `http://localhost:${PORT}`;
const DB = join(tmpdir(), `an-cu-su-co-${process.pid}.sqlite`);
const checks = [];
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  checks.push({ name, got, want, ok });
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};

let sv = null;
async function startServer(now) {
  sv = spawn(process.execPath, [join(root, 'server/index.mjs'), String(PORT)], {
    env: { ...process.env, AN_CU_DB: DB, ...(now ? { AN_CU_NOW: now } : {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  sv.stderr.on('data', (d) => { if (!/ExperimentalWarning|trace-warnings/.test(String(d))) process.stderr.write('[máy chủ] ' + d); });
  await new Promise((ok, fail) => {
    sv.stdout.once('data', ok);
    sv.once('exit', (c) => fail(new Error('Máy chủ thoát sớm, mã ' + c)));
  });
}
async function stopServer() {
  if (!sv) return;
  const s = sv; sv = null;
  s.kill();
  await new Promise((r) => s.once('exit', r));
}

// Người thuê: mô phỏng bằng fetch trực tiếp, tự quản lý cookie phiên (fetch của Node không giữ cookie).
function renterClient() {
  let cookie = '';
  return {
    async call(method, path, body) {
      const r = await fetch(B + path, {
        method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: r.status, body: await r.json() };
    },
    async login(phone) {
      const r = await this.call('POST', '/api/dang-nhap', { phone, password: 'matkhau123' });
      if (r.status !== 200) throw new Error('Đăng nhập người thuê thất bại: ' + JSON.stringify(r.body));
      return r.body.user;
    },
  };
}

const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
async function openPage(ctx, path) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(path + ': ' + e));
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.goto(B + path, { waitUntil: 'domcontentloaded' });
  return p;
}
async function landlordLogin(ctx) {
  const p = await ctx.newPage();
  await p.request.post(B + '/api/dang-nhap', { data: { phone: '0988000999', password: 'matkhau123' } });
  await p.close();
}
const shot = (p, name) => p.screenshot({ path: resolve(outDir, `su-co-${name}.png`) });

try {
  rmSync(DB, { force: true });
  await startServer('2026-10-18T09:00:00'); // mốc giống dữ liệu mẫu trong server/su-co.mjs

  console.log('\n=== 1. Người thuê gửi phiếu mới (mô phỏng qua API) ===');
  const an = renterClient();
  await an.login('0912000111'); // Nguyễn Văn An, P.101
  const created = await an.call('POST', '/api/su-co', {
    category: 'an-ninh', urgency: 'urgent', description: 'Cửa sổ phòng không khoá được, chốt cửa bị gãy từ sáng nay.',
  });
  expect('tạo phiếu mới thành công', created.status, 201);
  const newId = created.body.item.id;
  expect('mã phiếu đúng định dạng YC-xxxx', /^YC-\d{4}$/.test(newId), true);
  expect('phiếu mới ở trạng thái submitted', created.body.item.status, 'submitted');

  console.log('\n=== 2. Chủ trọ: mở trang Người thuê, thấy tab Sự cố có badge + chỉ báo ===');
  const ctxL = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await landlordLogin(ctxL);
  const land = await openPage(ctxL, '/quan-ly/nguoi-thue.html');
  await land.waitForTimeout(500);
  const badge = (await land.locator('#ticketTabBadge').textContent()).trim();
  expect('badge tab Sự cố đếm đúng số phiếu chưa xong (5: 4 seed mở + 1 vừa tạo, YC-0009 đã done)', badge, '5');
  expect('badge tô đỏ vì có phiếu khẩn cấp', await land.locator('#ticketTabBadge').evaluate((el) => el.classList.contains('urgent')), true);

  console.log('\n=== 3. Lối vào (b): bấm chỉ báo "N sự cố" ở dòng người thuê An (P.101, 2 phiếu mở) ===');
  const anRow = land.locator('#tenantRows tr', { hasText: 'Nguyễn Văn An' });
  await anRow.locator('[data-flag-room]').click();
  await land.waitForTimeout(400);
  expect('bấm chỉ báo nhiều phiếu -> chuyển sang tab Sự cố', await land.locator('#tabBtnTickets').getAttribute('aria-selected'), 'true');
  expect('URL cập nhật ?tab=su-co', new URL(land.url()).searchParams.get('tab'), 'su-co');
  const searchVal = await land.locator('#qInput').inputValue();
  expect('ô tìm kiếm lọc sẵn theo phòng P.101', searchVal, 'P.101');
  const ticketCount = await land.locator('#ticketRows .ticket-row').count();
  expect('danh sách lọc còn đúng 2 phiếu của P.101', ticketCount, 2);
  await shot(land, 'tab-su-co-loc-theo-phong');

  console.log('\n=== 4. Lối vào (a): bấm thẳng một phiếu trong tab Sự cố -> mở drawer ===');
  await land.locator('#ticketRows [data-open-ticket="' + newId + '"]').click();
  await land.waitForSelector('#ticketDrawer.open');
  expect('URL cập nhật ?ticket=' + newId, new URL(land.url()).searchParams.get('ticket'), newId);
  expect('tiêu đề drawer đúng mã phiếu', (await land.locator('#drawerTitle').textContent()).indexOf(newId) === 0, true);
  await shot(land, 'drawer-mo-tu-danh-sach');

  console.log('\n=== 5. Chủ trọ chuyển trạng thái + trả lời trong drawer ===');
  await land.selectOption('#drawerStatus', 'in_progress');
  await land.waitForTimeout(300);
  await land.fill('#drawerReplyText', 'Chị cho thợ qua sửa chốt cửa chiều nay nhé.');
  await land.locator('#drawerReplyForm button[type="submit"]').click();
  await land.waitForTimeout(300);
  const threadTexts = await land.locator('#drawerBody .msg .bubble').allTextContents();
  expect('tin nhắn chủ trọ xuất hiện trong luồng trao đổi', threadTexts.some((t) => t.includes('Chị cho thợ qua sửa chốt cửa')), true);

  console.log('\n=== 6. Tải lại trang với ?ticket= trên URL vẫn mở đúng phiếu ===');
  await land.reload({ waitUntil: 'domcontentloaded' });
  await land.waitForSelector('#ticketDrawer.open');
  expect('tải lại trang với ?ticket= mở lại đúng phiếu', (await land.locator('#drawerTitle').textContent()).indexOf(newId) === 0, true);
  expect('trạng thái đã lưu (Đang xử lý) hiển thị đúng sau khi tải lại', await land.locator('#drawerStatus').inputValue(), 'in_progress');

  console.log('\n=== 7. Đóng drawer: bỏ ?ticket khỏi URL, giữ nguyên tab và bộ lọc đang xem ===');
  // Bước 6 vừa tải lại trang (reload) nên bộ lọc gõ dở không có lý do giữ qua lần tải lại đó
  // (chỉ ?tab và ?ticket được ghi vào URL) — gõ lại bộ lọc rồi mới kiểm tra việc ĐÓNG drawer
  // (không reload) có giữ nguyên bộ lọc hiện tại hay không, đúng như yêu cầu ở mục 5 của đề bài.
  await land.fill('#qInput', 'P.101');
  await land.click('#drawerCloseBtn');
  await land.waitForTimeout(400);
  expect('đóng drawer xoá ?ticket khỏi URL', new URL(land.url()).searchParams.get('ticket'), null);
  expect('vẫn ở tab Sự cố sau khi đóng drawer', new URL(land.url()).searchParams.get('tab'), 'su-co');
  expect('bộ lọc tìm kiếm vẫn còn "P.101"', await land.locator('#qInput').inputValue(), 'P.101');

  console.log('\n=== 8. Lối vào (c): bấm thông báo trên chuông khi đang ở trang khác thì vẫn mở đúng phiếu ===');
  // Người thuê nhắn thêm -> sinh thông báo mới cho chủ trọ, rồi mở lại trang (giả lập "đang ở trang khác"
  // bằng cách tải lại — quan-ly/nguoi-thue.html là trang duy nhất có chuông sống trong phạm vi đã làm).
  await an.call('POST', `/api/su-co/${newId}/tin-nhan`, { body: 'Dạ vâng ạ, em cảm ơn chị.' });
  await land.reload({ waitUntil: 'domcontentloaded' });
  await land.waitForTimeout(600);
  await land.click('#notiBtn');
  await land.waitForTimeout(300);
  const notiOpen = await land.evaluate(() => document.getElementById('notiPop').classList.contains('open'));
  expect('mở popover thông báo', notiOpen, true);
  await shot(land, 'chuong-thong-bao');
  const firstNoti = land.locator('#notiList [data-goto-ticket]').first();
  expect('có thông báo gắn sẵn mã phiếu để điều hướng', await firstNoti.count() > 0, true);
  const gotoAttr = await firstNoti.getAttribute('data-goto-ticket');
  await firstNoti.click();
  await land.waitForSelector('#ticketDrawer.open');
  const gotoTitle = await land.evaluate(() => document.getElementById('drawerTitle').textContent);
  expect('bấm thông báo mở đúng phiếu mà thông báo đó trỏ tới', gotoTitle.indexOf(gotoAttr) === 0, true);
  expect('bấm thông báo cũng chuyển sang tab Sự cố', await land.locator('#tabBtnTickets').getAttribute('aria-selected'), 'true');

  console.log('\n=== 9. Phiếu khẩn cấp luôn nằm trên cùng khi còn mở ===');
  const firstRow = land.locator('#ticketRows .ticket-row').first();
  await land.click('#drawerCloseBtn');
  await land.waitForTimeout(400);
  await land.fill('#qInput', '');
  await land.selectOption('#stFilter', '');
  await land.waitForTimeout(200);
  expect('phiếu đầu danh sách là khẩn cấp + chưa xong', await firstRow.evaluate((el) => el.classList.contains('is-urgent-open')), true);

  console.log('\n=== 10. Chủ trọ chuyển "Chờ xác nhận"; người thuê báo "Vẫn còn lỗi" quay lại Đang xử lý ===');
  await land.click('#ticketRows [data-open-ticket="' + newId + '"]');
  await land.waitForSelector('#ticketDrawer.open');
  await land.selectOption('#drawerStatus', 'cho_xac_nhan');
  await land.waitForTimeout(300);
  const vanConLoi = await an.call('PATCH', `/api/su-co/${newId}`, { action: 'van-con-loi' });
  expect('người thuê báo "vẫn còn lỗi" -> phiếu quay lại in_progress', vanConLoi.body.item.status, 'in_progress');

  console.log('\n=== 11. Chủ trọ chuyển lại "Chờ xác nhận"; người thuê "Đã ổn" -> hoàn thành ===');
  await land.selectOption('#drawerStatus', 'cho_xac_nhan'); // drawer vẫn đang mở từ bước 10
  await land.waitForTimeout(300);
  const daOn = await an.call('PATCH', `/api/su-co/${newId}`, { action: 'da-on' });
  expect('người thuê xác nhận "Đã ổn" -> done', daOn.body.item.status, 'done');
  await land.reload({ waitUntil: 'domcontentloaded' });
  await land.waitForSelector('#ticketDrawer.open');
  expect('drawer phiếu đã xong chỉ còn ghi chú, không còn chọn trạng thái', await land.locator('#drawerStatus').count(), 0);

  console.log('\n=== 12. Quét tự động: 3 ngày ở "Chờ xác nhận" mà không phản hồi thì tự "Đã hoàn thành" ===');
  await stopServer();
  await startServer('2026-10-21T09:05:00'); // hơn 3 ngày sau khi YC-0011 (seed) chuyển cho_xac_nhan lúc 2026-10-17T08:00
  const sweepCheck = renterClient();
  await sweepCheck.login('0987000222'); // Trần Mỹ Linh, chủ phiếu YC-0011
  const afterSweep = await sweepCheck.call('GET', '/api/su-co');
  const yc11 = afterSweep.body.items.find((t) => t.id === 'YC-0011');
  expect('YC-0011 tự chuyển "done" sau 3 ngày chờ xác nhận không phản hồi', yc11 && yc11.status, 'done');
  expect('có tin nhắn hệ thống ghi lại việc tự động hoàn thành', (yc11.messages || []).some((m) => /Tự động đánh dấu/.test(m.body)), true);

  console.log('\n=== 13. Phiếu sự cố là bảng mới, không đụng support_tickets (chủ trọ -> quản trị) ===');
  const adminTickets = renterClient();
  const adminLogin = await adminTickets.call('POST', '/api/dang-nhap', { phone: '0900000001', password: 'matkhau123' });
  expect('đăng nhập quản trị vẫn bình thường', adminLogin.status, 200);
  const hoTroCu = await adminTickets.call('GET', '/api/quan-tri/ho-tro');
  expect('hệ thống hỗ trợ chủ trọ -> quản trị cũ không đổi (vẫn 3 phiếu mẫu)', hoTroCu.body.items.length, 3);

  console.log('\n=== 14. Responsive: không cuộn ngang, chạm đủ 44px, không lỗi JS ===');
  for (const vp of [{ w: 1440, h: 1000, tag: 'desktop' }, { w: 390, h: 844, tag: 'mobile' }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
    await landlordLogin(ctx);
    const p = await openPage(ctx, '/quan-ly/nguoi-thue.html?tab=su-co');
    await p.waitForTimeout(700);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(`[${vp.tag}] không cuộn ngang`, overflow <= 0, true);
    const small = await p.evaluate(() => {
      const sel = '.tab-btn, .incident-flag, .ticket-row, .drawer-close, .icon-btn, .act';
      return [...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null)
        .map((el) => el.getBoundingClientRect()).filter((r) => r.height < 44).length;
    });
    expect(`[${vp.tag}] không có touch target < 44px`, small, 0);
    await shot(p, 'tab-su-co-' + vp.tag);
    await ctx.close();
  }

  console.log('\n=== 15. tai-khoan/ho-tro.html (trang thật) nối đúng API /api/su-co*, bỏ dữ liệu mẫu cứng ===');
  const ctxHuy = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctxHuy.request.post(B + '/api/dang-nhap', { data: { phone: '0933000333', password: 'matkhau123' } }); // Lê Quang Huy, P.302
  const hoTro = await openPage(ctxHuy, '/tai-khoan/ho-tro.html');
  await hoTro.waitForTimeout(600);
  const toLineText = (await hoTro.locator('#toLine').textContent()) || '';
  expect('toLine lấy đúng tên chủ trọ thật (Trần Hoà), không phải dữ liệu mẫu', toLineText.includes('Trần Hoà'), true);
  expect('toLine không còn hiện dữ liệu mẫu cứng "Nguyễn Văn A"', toLineText.includes('Nguyễn Văn A'), false);

  const existingCount = await hoTro.locator('#ticketBox .ticket').count();
  await hoTro.selectOption('#fCat', 'dien-nuoc');
  const moTa = 'Ổ điện trong phòng tắm bị ẩm, bật quạt hút thì nhảy aptomat, kiểm thử gửi qua trang thật.';
  await hoTro.fill('#fDesc', moTa);
  await hoTro.click('#sendBtn');
  await hoTro.waitForSelector('#toast.show');
  await hoTro.waitForTimeout(400);
  const newCount = await hoTro.locator('#ticketBox .ticket').count();
  expect('gửi phiếu qua trang thật -> danh sách tăng thêm 1', newCount, existingCount + 1);
  const rowText = await hoTro.locator('#ticketBox .ticket').first().textContent();
  expect('phiếu mới nhất hiện đúng mô tả vừa gửi', (rowText || '').includes('Ổ điện trong phòng tắm bị ẩm'), true);
  const huyTicketId = await hoTro.locator('#ticketBox .ticket').first().getAttribute('data-ticket');
  await shot(hoTro, 'ho-tro-gui-phieu-desktop');

  await hoTro.locator('#ticketBox .ticket').first().click();
  await hoTro.waitForSelector('#tkDlg[open]');
  const descBoxText = await hoTro.locator('.desc-box').textContent();
  expect('hộp thoại chi tiết hiện đúng mô tả (description từ máy chủ)', (descBoxText || '').includes('Ổ điện trong phòng tắm bị ẩm'), true);
  const sysMsg = await hoTro.locator('.msg.system .bubble').first().textContent();
  expect('tin nhắn hệ thống do máy chủ sinh ra xuất hiện trong luồng trao đổi', (sysMsg || '').includes('đã gửi tới chủ trọ'), true);
  await hoTro.click('[data-close]');

  console.log('\n=== 16. Phiếu gửi từ tai-khoan/ho-tro.html thật sự tới được phía Chủ trọ ===');
  await land.bringToFront();
  await land.reload({ waitUntil: 'domcontentloaded' });
  await land.waitForTimeout(600);
  const landlordRows = await land.locator('#ticketRows .ticket-row').allTextContents();
  expect('chủ trọ thấy phiếu người thuê vừa gửi từ trang thật', landlordRows.some((t) => t.includes('Lê Quang Huy') && t.includes('P.302')), true);

  console.log('\n=== 17. "Chờ xác nhận" trên tai-khoan/ho-tro.html: 4 bước tiến độ + nút Đã ổn / Vẫn còn lỗi ===');
  await land.goto(B + '/quan-ly/nguoi-thue.html?tab=su-co&ticket=' + huyTicketId, { waitUntil: 'domcontentloaded' });
  await land.waitForSelector('#ticketDrawer.open');
  await land.selectOption('#drawerStatus', 'cho_xac_nhan');
  await land.waitForTimeout(300);

  await hoTro.bringToFront();
  await hoTro.reload({ waitUntil: 'domcontentloaded' });
  await hoTro.waitForTimeout(600);
  await hoTro.locator('#ticketBox [data-ticket="' + huyTicketId + '"]').click();
  await hoTro.waitForSelector('#tkDlg[open]');
  const stepCount = await hoTro.locator('.steps li').count();
  expect('thanh tiến độ có đủ 4 bước (thêm "Chờ xác nhận")', stepCount, 4);
  const stepLabels = await hoTro.locator('.steps li b').allTextContents();
  expect('bước thứ 3 đúng là "Chờ xác nhận"', stepLabels[2], 'Chờ xác nhận');
  const nowStepIdx = await hoTro.locator('.steps li.now').evaluate((el) => Array.from(el.parentElement.children).indexOf(el));
  expect('bước hiện tại (now) đúng là "Chờ xác nhận", không lẫn với "Đang xử lý"', nowStepIdx, 2);
  expect('có 2 nút xác nhận "Vẫn còn lỗi" và "Đã ổn"', await hoTro.locator('[data-confirm]').count(), 2);

  await hoTro.click('[data-confirm="van-con-loi"]');
  await hoTro.waitForSelector('#toast.show');
  await hoTro.waitForTimeout(300);
  expect('bấm "Vẫn còn lỗi" -> huy hiện trạng thái Đang xử lý', (await hoTro.locator('#tkSub .status').textContent()) || '', 'Đang xử lý');

  await land.bringToFront();
  await land.waitForTimeout(300);
  await land.selectOption('#drawerStatus', 'cho_xac_nhan');
  await land.waitForTimeout(300);
  await hoTro.bringToFront();
  await hoTro.reload({ waitUntil: 'domcontentloaded' });
  await hoTro.waitForTimeout(600);
  await hoTro.locator('#ticketBox [data-ticket="' + huyTicketId + '"]').click();
  await hoTro.waitForSelector('#tkDlg[open]');
  await hoTro.click('[data-confirm="da-on"]');
  await hoTro.waitForSelector('#toast.show');
  await hoTro.waitForTimeout(300);
  expect('bấm "Đã ổn" -> chuyển Đã hoàn thành', (await hoTro.locator('#tkSub .status').textContent()) || '', 'Đã hoàn thành');
  expect('phiếu đã xong: không còn nút xác nhận, chỉ còn "Gửi yêu cầu mới"', await hoTro.locator('[data-confirm]').count(), 0);
  expect('phiếu đã xong hiện nút "Gửi yêu cầu mới"', await hoTro.locator('[data-again]').count(), 1);

  const ctxMobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctxMobile.request.post(B + '/api/dang-nhap', { data: { phone: '0933000333', password: 'matkhau123' } });
  const hoTroMobile = await openPage(ctxMobile, '/tai-khoan/ho-tro.html');
  await hoTroMobile.waitForTimeout(600);
  await hoTroMobile.locator('#ticketBox [data-ticket="' + huyTicketId + '"]').click();
  await hoTroMobile.waitForSelector('#tkDlg[open]');
  const mobileOverflow = await hoTroMobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('[mobile 390px] thanh 4 bước không làm vỡ bố cục (không cuộn ngang)', mobileOverflow <= 0, true);
  await shot(hoTroMobile, 'ho-tro-4-buoc-mobile');
  await ctxMobile.close();

  console.log('\n=== 18. Chưa đăng nhập: trang hiện đúng thông báo "cần đăng nhập", không vỡ giao diện ===');
  const ctxAnon = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const anonPage = await openPage(ctxAnon, '/tai-khoan/ho-tro.html');
  await anonPage.waitForTimeout(600);
  const anonToLine = (await anonPage.locator('#toLine').textContent()) || '';
  expect('chưa đăng nhập: toLine báo cần đăng nhập', anonToLine.includes('đăng nhập'), true);
  const anonOverflow = await anonPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('[mobile 390px] chưa đăng nhập vẫn không cuộn ngang', anonOverflow <= 0, true);
  await shot(anonPage, 'ho-tro-can-dang-nhap-mobile');
  await ctxAnon.close();
  await ctxHuy.close();

  expect('không có lỗi JS trong suốt kịch bản', errors, []);
} finally {
  await browser.close();
  await stopServer();
  rmSync(DB, { force: true });
}

writeFileSync(resolve(outDir, 'su-co-report.json'), JSON.stringify(checks, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
