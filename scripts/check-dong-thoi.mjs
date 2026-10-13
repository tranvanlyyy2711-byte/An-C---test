// Kiểm thử đồng thời THẬT bằng nhiều tiến trình cùng ghi một file SQLite.
// Chạy: npm run test:dong-thoi
//
// Trong một tiến trình Node, DatabaseSync chạy đồng bộ nên hai request không bao giờ chen
// vào giữa nhau — kiểm thử 30 request trong test:lich vì thế không thử được giao dịch.
// Ở đây mỗi người đặt là một tiến trình riêng, cùng xuất phát ở một mốc giờ, và móc
// afterCheck ngủ 40ms giữa "kiểm tra" và "ghi" để nới rộng khe hở đua.
//
//  1. Đối chứng: cùng logic nhưng KHÔNG giao dịch -> phải thấy hơn 1 lịch chồng nhau
//     (chứng minh kịch bản thật sự tạo ra đua; nếu không, các mục sau chẳng chứng minh gì).
//  2. Chồng lấn một phần (09:00, 09:03, …) qua openDb: chỉ mục duy nhất KHÔNG bắt được,
//     chỉ còn giao dịch BEGIN IMMEDIATE -> đúng 1 lịch.
//  3. Cùng một khung giờ qua openDb -> đúng 1 lịch.
//  4. Xác nhận nguyên tử: lịch quá hạn, lịch đã xác nhận đều không xác nhận lại được.
import { spawn } from 'child_process';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.mjs';

const SELF = fileURLToPath(import.meta.url);
const NOW = new Date('2026-09-18T08:15:00');
const DATE = '2026-09-25';
const N = 8;
const RENTERS = ['u-trang', 'u-an', 'u-linh', 'u-huy'];

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const waitUntil = (t) => { while (Date.now() < t) { /* chờ cùng xuất phát */ } };
// 09:00, 09:03, … 09:21: mọi cặp đều chồng nhau (buổi xem dài 30 phút) nhưng không trùng đúng giờ
const timeOf = (i) => `09:${String(i * 3).padStart(2, '0')}`;

// ================= Tiến trình con: một người đặt =================
if (process.argv[2] === 'worker') {
  const [, , , mode, file, startAt, idx] = process.argv;
  const i = Number(idx);
  let result;
  try {
    if (mode === 'naive') {
      const db = new DatabaseSync(file);
      db.exec('PRAGMA busy_timeout = 5000');
      waitUntil(Number(startAt));
      const busy = db.prepare(`SELECT COUNT(*) AS n FROM viewing_appointments
        WHERE room_id = 'P.101' AND date = ? AND status IN ('pending','confirmed')`).get(DATE).n;
      sleepSync(40);
      if (busy === 0) {
        db.prepare(`INSERT INTO viewing_appointments (room_id, tenant_name, tenant_phone, date, time, dur, status, source, created_at)
          VALUES ('P.101', ?, '0900000000', ?, ?, 30, 'pending', 'naive', ?)`).run('Khách ' + i, DATE, timeOf(i), NOW.toISOString());
        result = 'ok';
      } else result = 'taken';
      db.close();
    } else {
      const store = openDb({ file, now: () => NOW, afterCheck: () => sleepSync(40) });
      waitUntil(Number(startAt));
      if (mode === 'overlap') {
        store.createForLandlord({ roomId: 'P.102', tenant: 'Khách ' + i, phone: '0900000000', date: DATE, time: timeOf(i) });
      } else {
        store.createForRenter({ nguoi: RENTERS[i % RENTERS.length], roomId: 'p01', date: DATE, time: '10:00' });
      }
      result = 'ok';
      store.close();
    }
  } catch (e) {
    result = e.code === 'slot_taken' ? 'taken' : 'error:' + (e.code || e.message);
  }
  process.stdout.write(result);
  process.exit(0);
}

// ================= Tiến trình chính =================
let failed = false;
const expect = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed = true;
  console.log((ok ? 'ĐẠT  ' : 'HỎNG ') + name + (ok ? '' : `  => ${JSON.stringify(got)} (mong đợi ${JSON.stringify(want)})`));
};
const DB = join(tmpdir(), `an-cu-dong-thoi-${process.pid}.sqlite`);
const cleanup = () => { for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true }); };
cleanup();
openDb({ file: DB, now: () => NOW }).close(); // tạo lược đồ + dữ liệu mẫu

function race(mode) {
  const startAt = Date.now() + 1500; // đủ để mọi tiến trình khởi động xong rồi cùng xuất phát
  return Promise.all(Array.from({ length: N }, (_, i) => new Promise((ok) => {
    const p = spawn(process.execPath, ['--no-warnings', SELF, 'worker', mode, DB, String(startAt), String(i)]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => process.stderr.write('[con] ' + d));
    p.on('exit', () => ok(out));
  })));
}
const count = (rs, v) => rs.filter((r) => r === v).length;
const activeRows = (room) => {
  const db = new DatabaseSync(DB);
  const n = db.prepare(`SELECT COUNT(*) AS n FROM viewing_appointments
    WHERE room_id = ? AND date = ? AND status IN ('pending','confirmed')`).get(room, DATE).n;
  db.close();
  return n;
};

try {
  const naive = await race('naive');
  const naiveRows = activeRows('P.101');
  console.log(`      (đối chứng: ${naiveRows}/${N} tiến trình cùng ghi được)`);
  expect('Đối chứng không giao dịch: đua thật sự xảy ra (> 1 lịch chồng nhau)', naiveRows > 1, true);
  expect('Đối chứng: không tiến trình nào lỗi', naive.filter((r) => r.startsWith('error')), []);

  const ov = await race('overlap');
  expect(`Chồng lấn một phần, ${N} tiến trình: đúng 1 thành công`, count(ov, 'ok'), 1);
  expect(`Chồng lấn một phần: ${N - 1} bị từ chối slot_taken`, count(ov, 'taken'), N - 1);
  expect('Chồng lấn một phần: DB chỉ có 1 lịch còn hiệu lực', activeRows('P.102'), 1);

  const same = await race('same');
  expect(`Cùng khung giờ, ${N} tiến trình: đúng 1 thành công`, count(same, 'ok'), 1);
  expect(`Cùng khung giờ: ${N - 1} bị từ chối slot_taken`, count(same, 'taken'), N - 1);
  expect('Cùng khung giờ: DB chỉ có 1 lịch còn hiệu lực', activeRows('p01'), 1);

  // Xác nhận nguyên tử
  const store = openDb({ file: DB, now: () => NOW });
  const a = store.createForRenter({ nguoi: 'u-an', roomId: 'p02', date: DATE, time: '13:30' });
  const b = store.createForRenter({ nguoi: 'u-linh', roomId: 'p02', date: DATE, time: '15:00' });
  expect('Xác nhận lịch còn chờ: thành công', store.updateForLandlord(a.id, { action: 'confirm' }).status, 'confirmed');
  const again = (() => { try { store.updateForLandlord(a.id, { action: 'confirm' }); return 'ok'; } catch (e) { return e.code; } })();
  expect('Xác nhận lần hai: bị từ chối not_pending', again, 'not_pending');
  store.close();
  // Đồng hồ chạy qua 24 giờ: lịch b quá hạn giữ chỗ
  const later = openDb({ file: DB, now: () => new Date(NOW.getTime() + 25 * 3600000) });
  const late = (() => { try { later.updateForLandlord(b.id, { action: 'confirm' }); return 'ok'; } catch (e) { return e.message; } })();
  expect('Xác nhận lịch đã quá hạn: bị từ chối, báo quá hạn', /quá hạn/.test(late), true);
  // Giao dịch lỗi thì ROLLBACK cả bước sweep, nên dòng có thể còn 'pending' tới thao tác kế tiếp —
  // vô hại vì mọi thao tác đều sweep trước. Điều cần bảo đảm: không bao giờ thành 'confirmed'.
  expect('Lịch quá hạn không bị chuyển thành confirmed', later.db.prepare('SELECT status FROM viewing_appointments WHERE id = ?').get(b.id).status !== 'confirmed', true);
  later.listAll();
  expect('Thao tác kế tiếp nhả lịch quá hạn: cancelled', later.db.prepare('SELECT status FROM viewing_appointments WHERE id = ?').get(b.id).status, 'cancelled');
  later.close();
} finally {
  cleanup();
}

console.log(failed ? '\nCÓ MỤC HỎNG' : '\nTẤT CẢ ĐẠT');
process.exit(failed ? 1 : 0);
