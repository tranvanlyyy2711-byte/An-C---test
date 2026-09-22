// Kiểm thử khu "Tìm phòng" trên trang chủ + chụp ảnh 1440 / 768 / 390px.
// Chạy: node scripts/shot-rooms.mjs [tag]
// Luật đang kiểm: chưa bấm Tìm phòng thì hiện 6 phòng mẫu, "Xem thêm phòng" mở đủ 20 phòng; vị trí chọn
// trong 126 phường/xã Hà Nội hiện hành; chỉ lọc khi đã chọn đủ vị trí + khoảng giá + số người ở VÀ bấm
// "Tìm phòng" (đổi ô chọn, chip hay "Áp dụng" đều không tự lọc); "Xoá bộ lọc" trả về danh sách mẫu.
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { mkdirSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
mkdirSync(outDir, { recursive: true });

const url = 'file://' + resolve(root, 'index.html').replace(/\\/g, '/');
const tag = process.argv[2] || 'rooms';

const targets = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

const browser = await chromium.launch({ channel: 'msedge' });
const report = [];
let failed = false;

for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.width, height: t.height }, deviceScaleFactor: 1 });
  const errors = [];
  const checks = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(300);

  const shot = (step) => page.screenshot({ path: resolve(outDir, `${tag}-${step}-${t.name}.png`) });
  const cards = () => page.locator('#roomGrid .room').count();
  const txt = async (sel) => ((await page.locator(sel).textContent()) || '').trim();
  const visible = (sel) => page.locator(sel).isVisible();
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failed = true;
    checks.push({ name, got, want, ok });
  };
  const toFinder = () => page.evaluate(() => {
    const el = document.getElementById('finder');
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 96);
  });
  const search = async () => { await page.click('#finder .btn-find'); await page.waitForTimeout(150); };
  // Chọn một phường/xã qua hộp chọn vị trí thật: gõ tìm, bấm chip, bấm "Áp dụng"
  const pickCity = async (slug) => {
    await page.click('#locationTrigger');
    await page.waitForSelector('#filterOverlay.open');
    await page.click(`.city-chip[data-city="${slug}"]`);
    await page.waitForTimeout(80);
  };
  const pickLocation = async (query, name, slug = 'ha-noi') => {
    await pickCity(slug);
    await page.fill('#filterSearch', query);
    await page.waitForTimeout(120);
    await page.click(`.filter-panel.active .filter-chip[data-location-value="${name}"]`);
    await page.click('#filterApply');
    await page.waitForTimeout(120);
  };

  // ---- 1. Mới vào trang: 6 phòng mẫu, "Xem thêm phòng" mở đủ 20 ----
  await toFinder();
  await page.waitForTimeout(300);
  expect('mới vào trang: hiện 6 phòng mẫu', await cards(), 6);
  expect('mới vào trang: đếm phòng mẫu', await txt('#roomCount'), 'Có 10 phòng mới đăng');
  expect('mới vào trang: có nút Xem thêm phòng', await visible('#viewAllRooms'), true);
  expect('ô vị trí để trống', await txt('#locationValue'), 'Chọn tỉnh/thành, phường/xã');
  await shot('start');
  await page.click('#viewAllRooms');
  await page.waitForTimeout(150);
  expect('bấm Xem thêm phòng: hiện đủ 10 phòng', await cards(), 10);
  expect('mọi ảnh phòng là ảnh thật trong assets/rooms/', await page.locator('#roomGrid img').evaluateAll((els) => els.length > 0 && els.every((i) => i.getAttribute('src').startsWith('assets/rooms/'))), true);
  expect('đã mở hết: ẩn nút Xem thêm', await visible('#viewAllRooms'), false);

  // ---- 2. Bấm Tìm phòng khi chưa chọn gì ----
  await toFinder();
  await search();
  expect('thiếu cả 3: báo lỗi', await txt('#finderErr'), 'Vui lòng chọn vị trí, khoảng giá và số người ở rồi bấm Tìm phòng.');
  expect('thiếu cả 3: đánh dấu 3 ô', await page.locator('#finder .fld.invalid').count(), 3);
  expect('thiếu cả 3: không lọc, giữ nguyên 10 phòng mẫu', await cards(), 10);
  await shot('missing');

  // ---- 3. Hộp chọn vị trí: đủ 126 phường/xã ----
  await page.click('#locationTrigger');
  await page.waitForSelector('#filterOverlay.open');
  expect('tab Phường ghi 51', await txt('#countPhuong'), '51');
  expect('tab Xã ghi 75', await txt('#countXa'), '75');
  await page.click('#showMorePhuong');
  expect('mở hết tab Phường: 51 lựa chọn', await page.locator('#phuongList .filter-chip').count(), 51);
  await page.click('.filter-tab[data-filter-tab="xa"]');
  await page.click('#showMoreXa');
  expect('mở hết tab Xã: 75 lựa chọn', await page.locator('#xaList .filter-chip').count(), 75);
  expect('không còn tab "Khu vực" (phường cũ trước sáp nhập)', await page.locator('.filter-tab[data-filter-tab="area"]').count(), 0);
  await page.fill('#filterSearch', 'hoa lac');
  await page.waitForTimeout(120);
  expect('gõ không dấu "hoa lac" ra xã Hòa Lạc', await page.locator('#xaList .filter-chip').allTextContents(), ['Hòa Lạc']);
  await page.fill('#filterSearch', 'nghia do');
  await page.waitForTimeout(120);
  expect('tìm "nghia do" tự chuyển sang tab Phường', await txt('.filter-tab.active'), 'Phường1');
  await shot('location-modal');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);

  // ---- 4. Chọn dần từng ô: không tự lọc ----
  await pickLocation('nghia do', 'Nghĩa Đô');
  expect('ô vị trí hiện phường đã chọn kèm thành phố', await txt('#locationValue'), 'Phường Nghĩa Đô, Hà Nội');
  expect('bấm Áp dụng vị trí: chưa lọc', await cards(), 10);
  await page.selectOption('#fPrice', '3000000-4000000');
  expect('chọn giá: chưa lọc', await cards(), 10);
  await page.click('.qc[data-amen="Có bếp riêng"]');
  expect('bấm chip Lọc nhanh: chưa lọc', await cards(), 10);
  await search();
  expect('thiếu số người: báo đúng ô còn thiếu', await txt('#finderErr'), 'Vui lòng chọn số người ở rồi bấm Tìm phòng.');
  expect('thiếu số người: chưa lọc', await cards(), 10);
  await page.selectOption('#fPeople', '2');
  expect('chọn đủ 3 nhưng chưa bấm: chưa lọc', await cards(), 10);

  // ---- 5. Bấm Tìm phòng ----
  await search();
  expect('đủ 3 + bấm Tìm phòng: hiện đúng 1 phòng', await cards(), 1);
  expect('hết báo lỗi', await visible('#finderErr'), false);
  expect('đếm kết quả kèm vị trí', await txt('#roomCount'), 'Tìm thấy 1 phòng phù hợp tại Phường Nghĩa Đô, Hà Nội');
  expect('địa chỉ trên card theo phường mới, không còn quận', await txt('#roomGrid .room .addr'), 'Phường Nghĩa Đô, Hà Nội');
  await toFinder();
  await page.waitForTimeout(200);
  await shot('result');

  // ---- 6. Đổi điều kiện sau khi đã tìm: giữ kết quả cũ, nhắc bấm lại ----
  await page.selectOption('#fPrice', '4000000-5000000');
  expect('đổi giá sau khi tìm: kết quả cũ giữ nguyên', await cards(), 1);
  expect('đổi giá sau khi tìm: nhắc bấm Tìm phòng', await txt('#roomHint'), 'Bạn vừa đổi điều kiện, bấm Tìm phòng để cập nhật kết quả.');
  await search();
  expect('bấm lại: áp dụng giá mới -> không có phòng', await cards(), 0);
  expect('không có phòng: hiện trạng thái rỗng', await visible('#roomEmpty'), true);
  expect('bấm lại: hết lời nhắc', await txt('#roomHint'), '');
  await toFinder();
  await page.waitForTimeout(200);
  await shot('empty');

  // ---- 6b. Xoá bộ lọc (nút trong khung "không có phòng") ----
  await page.click('#roomEmpty [data-room-reset]');
  await page.waitForTimeout(150);
  expect('xoá bộ lọc: về 6 phòng mẫu', await cards(), 6);
  expect('xoá bộ lọc: đếm lại phòng mẫu', await txt('#roomCount'), 'Có 10 phòng mới đăng');
  expect('xoá bộ lọc: trống ô vị trí', await txt('#locationValue'), 'Chọn tỉnh/thành, phường/xã');
  expect('xoá bộ lọc: trống giá và số người', [await page.inputValue('#fPrice'), await page.inputValue('#fPeople')], ['', '']);
  expect('xoá bộ lọc: tắt chip Lọc nhanh', await page.locator('.qc.on').count(), 0);
  expect('xoá bộ lọc: ẩn khung không có phòng', await visible('#roomEmpty'), false);

  // ---- 6c. Tìm theo xã ----
  await pickLocation('hoa lac', 'Hòa Lạc');
  await page.selectOption('#fPrice', '0-2000000');
  await page.selectOption('#fPeople', '2');
  await search();
  expect('xã Hòa Lạc, dưới 2 triệu, 2 người: ra 1 phòng', await cards(), 1);
  expect('địa chỉ theo xã mới', await txt('#roomGrid .room .addr'), 'Xã Hòa Lạc, Hà Nội');

  // Nút Xoá bộ lọc trên hàng Lọc nhanh
  await page.click('.quick [data-room-reset]');
  await page.waitForTimeout(150);
  expect('nút Xoá bộ lọc ở hàng Lọc nhanh: về 6 phòng mẫu', await cards(), 6);
  const resetBox = await page.locator('.quick [data-room-reset]').boundingBox();
  expect('nút Xoá bộ lọc cao ≥ 44px', !!resetBox && resetBox.height >= 44, true);
  await page.selectOption('#fPeople', 'custom');
  await page.fill('#fPeopleCustom', '3');
  await page.click('.quick [data-room-reset]');
  expect('Xoá bộ lọc: bỏ luôn số người tự nhập', [await visible('#fPeopleCustom'), await page.inputValue('#fPeople')], [false, '']);

  // ---- 7. So khớp đúng phường, không nhầm theo quận cũ ----
  await pickLocation('dong da', 'Đống Đa');
  await page.selectOption('#fPrice', '3000000-4000000');
  await page.selectOption('#fPeople', '1');
  await search();
  expect('phường Đống Đa không ra phòng của phường Kim Liên (quận Đống Đa cũ)', await cards(), 0);
  await pickLocation('kim lien', 'Kim Liên');
  await search();
  expect('phường Kim Liên, 3–4 triệu, 1 người: ra 1 phòng', await cards(), 1);

  // ---- 8. Số người: phòng ở được nhiều người hơn vẫn hợp ----
  await pickLocation('vinh tuy', 'Vĩnh Tuy');
  await page.selectOption('#fPeople', '1');
  await search();
  expect('1 người vẫn ra phòng ở được 2 người', await cards(), 1);
  await page.selectOption('#fPeople', '2');
  await search();
  expect('2 người ra phòng ở được 2 người', await cards(), 1);
  await page.selectOption('#fPeople', '3');
  await search();
  expect('3 người trở lên: phòng 2 người không đủ chỗ', await cards(), 0);

  // ---- 8b. Số người: "Tuỳ chọn…" để tự nhập ----
  await pickLocation('bach mai', 'Bạch Mai');
  await page.selectOption('#fPrice', '4000000-5000000');
  await page.selectOption('#fPeople', 'custom');
  await page.waitForTimeout(100);
  expect('chọn Tuỳ chọn: hiện ô nhập số người', await visible('#fPeopleCustom'), true);
  expect('chọn Tuỳ chọn: ẩn danh sách', await visible('#fPeople'), false);
  expect('chọn Tuỳ chọn: con trỏ vào ô nhập', await page.evaluate(() => document.activeElement.id), 'fPeopleCustom');
  await search();
  expect('Tuỳ chọn chưa nhập: báo lỗi', await txt('#finderErr'), 'Vui lòng chọn số người ở (nhập từ 1 đến 10) rồi bấm Tìm phòng.');
  await page.fill('#fPeopleCustom', '12');
  await search();
  expect('nhập 12 người (quá 10): vẫn báo lỗi', await visible('#finderErr'), true);
  await page.fill('#fPeopleCustom', '2');
  await search();
  expect('phường Bạch Mai, 4–5 triệu, tự nhập 2 người: ra 1 phòng', await cards(), 1);
  await toFinder();
  await page.waitForTimeout(150);
  await shot('people-custom');
  await page.fill('#fPeopleCustom', '3');
  await search();
  expect('tự nhập 3 người: không phòng nào đủ chỗ', await cards(), 0);
  await page.click('#fPeopleBack');
  expect('bấm ×: quay lại danh sách, chưa chọn', [await visible('#fPeople'), await page.inputValue('#fPeople')], [true, '']);
  await page.selectOption('#fPrice', '4000000-5000000');

  // ---- 8c. Tỉnh/thành và danh sách sau sắp xếp 2025 ----
  await page.click('#locationTrigger');
  await page.waitForSelector('#filterOverlay.open');
  expect('có đủ 6 tỉnh/thành', await page.locator('.city-chip').allTextContents(), ['Hà Nội', 'Hải Phòng', 'Đà Nẵng', 'TP. Hồ Chí Minh', 'Bình Dương nay thuộc TP.HCM', 'Cần Thơ']);
  const counts = async (slug) => {
    await page.click(`.city-chip[data-city="${slug}"]`);
    await page.waitForTimeout(80);
    const dk = await page.locator('.filter-tab[data-filter-tab="dackhu"]').isVisible();
    return [await txt('#countPhuong'), await txt('#countXa'), dk ? await txt('#countDackhu') : 'không có'];
  };
  expect('Hà Nội: 51 phường, 75 xã, không đặc khu', await counts('ha-noi'), ['51', '75', 'không có']);
  expect('Hải Phòng: 45 phường, 67 xã, 2 đặc khu', await counts('hai-phong'), ['45', '67', '2']);
  await page.click('.filter-tab[data-filter-tab="dackhu"]');
  expect('Hải Phòng: đặc khu Bạch Long Vĩ, Cát Hải', await page.locator('#dackhuList .filter-chip').allTextContents(), ['Bạch Long Vĩ', 'Cát Hải']);
  await page.click('#dackhuList .filter-chip[data-location-value="Cát Hải"]');
  expect('chọn đặc khu: nhãn kèm thành phố', await txt('#locationValue'), 'Đặc khu Cát Hải, Hải Phòng');
  expect('Đà Nẵng: 23 phường, 70 xã, 1 đặc khu', await counts('da-nang'), ['23', '70', '1']);
  expect('TP. Hồ Chí Minh: 113 phường, 54 xã, 1 đặc khu', await counts('ho-chi-minh'), ['113', '54', '1']);
  expect('Bình Dương cũ: 24 phường, 12 xã', await counts('binh-duong'), ['24', '12', 'không có']);
  expect('Bình Dương: ghi chú đã nhập vào TP. Hồ Chí Minh', /nhập vào TP. Hồ Chí Minh/.test(await txt('#cityNote')), true);
  expect('Cần Thơ: 31 phường, 72 xã, không đặc khu', await counts('can-tho'), ['31', '72', 'không có']);
  await page.click('.city-chip[data-city="binh-duong"]');
  await shot('location-cities');
  await page.keyboard.press('Escape');

  // Tìm theo cả tỉnh/thành
  const searchCity = async (slug, price, people) => {
    await pickCity(slug);
    await page.click('#filterApply');
    await page.selectOption('#fPrice', price);
    await page.selectOption('#fPeople', people);
    await search();
  };
  await searchCity('ho-chi-minh', '3000000-4000000', '2');
  expect('nhãn khi chọn cả thành phố', await txt('#locationValue'), 'TP. Hồ Chí Minh');
  expect('TP. Hồ Chí Minh chưa có tin: không lẫn phòng Hà Nội', await cards(), 0);
  expect('TP. Hồ Chí Minh chưa có tin: hiện trạng thái rỗng', [await visible('#roomEmpty'), await txt('#roomCount')], [true, 'Không có phòng phù hợp tại TP. Hồ Chí Minh']);
  await searchCity('binh-duong', '3000000-4000000', '2');
  expect('nhãn Bình Dương cũ', await txt('#locationValue'), 'Bình Dương cũ (TP. Hồ Chí Minh)');
  expect('Bình Dương cũ chưa có tin', await cards(), 0);
  await pickLocation('di an', 'Dĩ An', 'binh-duong');
  expect('chọn phường Dĩ An trong Bình Dương: nhãn theo TP. Hồ Chí Minh', await txt('#locationValue'), 'Phường Dĩ An, TP. Hồ Chí Minh');
  for (const slug of ['hai-phong', 'da-nang', 'can-tho']) {
    await searchCity(slug, '3000000-4000000', '2');
    expect(slug + ' chưa có tin: không lẫn phòng Hà Nội', await cards(), 0);
  }
  await searchCity('ha-noi', '4000000-5000000', '2');
  expect('cả Hà Nội, 4–5 triệu, 2 người: ra 3 phòng', await cards(), 3);
  expect('cả Hà Nội không lẫn phòng tỉnh khác', (await page.locator('#roomGrid .room .addr').allTextContents()).every((x) => x.trim().endsWith('Hà Nội')), true);

  // ---- 9. Chi tiết phòng, liên hệ, đăng nhập ----
  await pickLocation('kim lien', 'Kim Liên');
  await page.selectOption('#fPrice', '3000000-4000000');
  await page.selectOption('#fPeople', '2');
  await search();
  await page.locator('#roomGrid .room').first().click();
  await page.waitForSelector('.rd-overlay.open');
  await page.waitForTimeout(300);
  expect('chi tiết: đúng phòng', await txt('#rdTitle'), 'Phòng trọ tiện nghi giá tốt, trung tâm, gần chợ, trường học, bệnh viện');
  expect('chi tiết: địa chỉ theo phường mới', await txt('#rdAddr'), 'Phường Kim Liên, Hà Nội');
  expect('chi tiết: đúng 2 ảnh thật của tin', await page.locator('#rdThumbs img').evaluateAll((els) => els.map((i) => i.getAttribute('src'))), ['assets/rooms/dd1.webp', 'assets/rooms/dd2.webp']);
  await page.click('#rdContactBtn');
  await page.waitForTimeout(250);
  expect('liên hệ: hiện số chủ phòng', await txt('#rdPhone'), '0982 165 646');
  await shot('detail');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect('không cuộn ngang', overflow <= 0, true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  expect('Esc đóng chi tiết', await page.evaluate(() => !document.getElementById('rdOverlay').classList.contains('open')), true);

  expect('không có lỗi JS', errors, []);
  report.push({ viewport: t.name, checks, ok: checks.every((c) => c.ok) });
  await page.close();
}

await browser.close();
writeFileSync(resolve(outDir, tag + '-report.json'), JSON.stringify(report, null, 2), 'utf8');
for (const r of report) {
  console.log(`\n[${r.viewport}] ${r.ok ? 'ĐẠT' : 'CÓ MỤC HỎNG'}`);
  for (const c of r.checks) if (!c.ok) console.log(`  HỎNG ${c.name}: ${JSON.stringify(c.got)} (mong đợi ${JSON.stringify(c.want)})`);
  console.log(`  ${r.checks.filter((c) => c.ok).length}/${r.checks.length} mục đạt`);
}
process.exit(failed ? 1 : 0);
