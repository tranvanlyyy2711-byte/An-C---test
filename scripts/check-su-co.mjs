// Kiểm thử phiếu sự cố người thuê gửi chủ trọ, trên máy chủ thật (SQLite dùng chung).
// Chạy: npm run test:su-co
// Mô phỏng người thuê bằng fetch API trực tiếp (trang tai-khoan/ho-tro.html chưa nối API thật —
// xem docs/su-co-nguoi-thue.md), và chủ trọ bằng trình duyệt thật trên quan-ly/nguoi-thue.html,
// để kiểm cả 3 lối vào drawer, chỉ báo trong dòng người thuê, và chuông thông báo.
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

  console.log('\n=== 15. tai-khoan/ho-tro.html: giao diện thật bên người thuê (không chỉ gọi API trực tiếp) ===');
  const ctxTrang = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctxTrang.request.post(B + '/api/dang-nhap', { data: { phone: '0901234567', password: 'matkhau123' } }); // Phạm Thu Trang, chủ YC-0009/YC-0012
  const trang = await openPage(ctxTrang, '/tai-khoan/ho-tro.html');
  await trang.waitForTimeout(700);
  expect('ô "Gửi tới" hiện đúng chủ trọ và phòng', (await trang.locator('#toLine').textContent()).trim(), 'Gửi tới Trần Hoà · Phòng P.301 — Nhà trọ An Bình');
  expect('danh sách "Yêu cầu đã gửi" hiện đủ phiếu cũ của Trang (YC-0009, YC-0012)', await trang.locator('.tickets .ticket').count(), 2);
  await shot(trang, 'ho-tro-trang-mo-trang');

  await trang.selectOption('#fCat', 'hoa-don');
  await trang.fill('#fDesc', 'Hoá đơn tháng này ghi nhiều hơn mọi tháng, nhờ chủ trọ kiểm tra lại số công tơ giúp em.');
  await trang.click('#sendBtn');
  await trang.waitForTimeout(700);
  const sentToastTitle = await trang.locator('#toastTitle').textContent();
  expect('gửi phiếu qua form thật thành công (toast hiện đúng)', sentToastTitle.indexOf('Đã gửi yêu cầu') === 0, true);
  expect('phiếu mới xuất hiện ngay trong danh sách', await trang.locator('.tickets .ticket').count(), 3);
  const newUiTicketId = sentToastTitle.replace('Đã gửi yêu cầu ', '').trim();
  expect('phiếu mới nhất trên danh sách đúng là phiếu vừa gửi', await trang.locator('.tickets .ticket').first().getAttribute('data-ticket'), newUiTicketId);

  await trang.click('[data-ticket="YC-0012"]');
  await trang.waitForSelector('#tkDlg[open]');
  await trang.fill('#replyText', 'Dạ thứ 7 này em vẫn ở nhà, anh chị sắp xếp giúp em nhé.');
  await trang.click('#replyForm button[type="submit"]');
  await trang.waitForTimeout(600);
  const trangBubbles = await trang.locator('#tkBody .msg .bubble').allTextContents();
  expect('tin nhắn gửi từ drawer thật xuất hiện trong luồng trao đổi', trangBubbles[trangBubbles.length - 1], 'Dạ thứ 7 này em vẫn ở nhà, anh chị sắp xếp giúp em nhé.');
  await trang.click('[data-close]');
  await trang.waitForTimeout(300);

  // Chủ trọ (context "land" đã đăng nhập từ mục 2) chuyển YC-0012 sang chờ xác nhận
  await land.evaluate((B2) => fetch(B2 + '/api/chu-tro/su-co/YC-0012', {
    method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cho_xac_nhan' }),
  }), B);
  await trang.evaluate(() => window.dispatchEvent(new Event('focus'))); // trang vẫn mở, giả lập quay lại tab để nạp lại
  await trang.waitForTimeout(500);
  await trang.click('[data-ticket="YC-0012"]');
  await trang.waitForSelector('#tkDlg[open]');
  expect('phiếu "chờ xác nhận" hiện đúng 2 nút Đã ổn / Vẫn còn lỗi', await trang.locator('[data-confirm="da-on"], [data-confirm="van-con-loi"]').count(), 2);
  await shot(trang, 'ho-tro-cho-xac-nhan');
  await trang.click('[data-confirm="van-con-loi"]');
  await trang.waitForTimeout(500);
  expect('bấm "Vẫn còn lỗi" -> phiếu quay lại Đang xử lý ngay trên giao diện', (await trang.locator('#tkSub .status').textContent()).trim(), 'Đang xử lý');

  console.log('\n=== 16. tai-khoan/ho-tro.html: chưa đăng nhập thì khoá trang, không lộ form ===');
  const ctxAnon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const anon = await openPage(ctxAnon, '/tai-khoan/ho-tro.html');
  await anon.waitForTimeout(500);
  expect('hiện màn hình yêu cầu đăng nhập', await anon.locator('#loginGate').isVisible(), true);
  expect('không hiện form gửi yêu cầu khi chưa đăng nhập', await anon.locator('#mainLayout').isVisible(), false);
  await shot(anon, 'ho-tro-chua-dang-nhap');

  console.log('\n=== 17. tai-khoan/ho-tro.html: responsive 390px không cuộn ngang ===');
  const ctxTrangM = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctxTrangM.request.post(B + '/api/dang-nhap', { data: { phone: '0901234567', password: 'matkhau123' } });
  const trangM = await openPage(ctxTrangM, '/tai-khoan/ho-tro.html');
  await trangM.waitForTimeout(700);
  const hoTroOverflow = await trangM.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('[ho-tro.html mobile] không cuộn ngang', hoTroOverflow <= 0, true);
  await shot(trangM, 'ho-tro-mobile');

  expect('không có lỗi JS trong suốt kịch bản', errors, []);
} finally {
  await browser.close();
  await stopServer();
  rmSync(DB, { force: true });
}

writeFileSync(resolve(outDir, 'su-co-report.json'), JSON.stringify(checks, null, 2), 'utf8');
process.exit(failed ? 1 : 0);
