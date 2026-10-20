// Thông báo trong ứng dụng + đẩy sự kiện thời gian thực (SSE) cho hai phía người thuê / chủ trọ.
//
// Bảng `notifications` có từ trước (db.mjs), dùng chung cho thông báo của quản trị, sự cố và nay là
// lịch hẹn / thuê phòng. Ở đây:
//   - migrateNotifications(db): nới CHECK của cột `type` để nhận 'lich-hen' và 'thue-phong', thêm cột
//     `link` (trang cần mở khi bấm vào thông báo). SQLite không sửa được CHECK tại chỗ nên dựng lại
//     bảng, cùng kỹ thuật với migrateAuth / migrateNotiType.
//   - createBus(): giữ các kết nối SSE theo người dùng; publish(userIds, topics) báo cho đúng người
//     rằng dữ liệu nào vừa đổi, trình duyệt tự tải lại phần đó (components/an-cu-store.js).

export const NOTI_TYPES = ['bao-tri', 'tinh-nang', 'nhac-han', 'ho-tro', 'su-co', 'lich-hen', 'thue-phong'];

export function migrateNotifications(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notifications'").get();
  if (!row) return;
  const hasLink = db.prepare('PRAGMA table_info(notifications)').all().some((c) => c.name === 'link');
  if (NOTI_TYPES.every((t) => row.sql.includes(`'${t}'`)) && hasLink) return;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec(`
    CREATE TABLE notifications_moi (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL,
      type       TEXT    NOT NULL CHECK (type IN (${NOTI_TYPES.map((t) => `'${t}'`).join(',')})),
      title      TEXT    NOT NULL,
      body       TEXT    NOT NULL DEFAULT '',
      channel    TEXT    NOT NULL DEFAULT 'in-app',
      batch_id   TEXT,
      ref        TEXT,
      link       TEXT,                                -- trang mở khi bấm, vd 'tai-khoan/dat-lich.html?lich=12'
      created_at TEXT    NOT NULL,
      read_at    TEXT
    );
    INSERT INTO notifications_moi (id, user_id, type, title, body, channel, batch_id, ref, ${hasLink ? 'link, ' : ''}created_at, read_at)
      SELECT id, user_id, type, title, body, channel, batch_id, ref, ${hasLink ? 'link, ' : ''}created_at, read_at FROM notifications;
    DROP TABLE notifications;
    ALTER TABLE notifications_moi RENAME TO notifications;
    CREATE INDEX IF NOT EXISTS idx_noti_user ON notifications (user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS one_noti_per_ref ON notifications (ref) WHERE ref IS NOT NULL;
  `);
  db.exec('PRAGMA foreign_keys = ON');
}

// Ghi một thông báo. Gọi trong cùng giao dịch với thao tác gây ra nó, để không có thao tác thành công
// mà thiếu thông báo (hoặc ngược lại).
export function createNotifier(db, now) {
  let ins = null;
  return function notify(userId, type, title, body, link) {
    if (!userId) return;
    ins = ins || db.prepare(`INSERT INTO notifications (user_id, type, title, body, channel, link, created_at)
                             VALUES (?, ?, ?, ?, 'in-app', ?, ?)`);
    ins.run(userId, type, title, body || '', link || null, now().toISOString());
  };
}

// ---------- Kênh sự kiện (Server-Sent Events) ----------
export function createBus() {
  const clients = new Map();   // userId -> Set<res>

  function subscribe(userId, req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    if (!clients.has(userId)) clients.set(userId, new Set());
    clients.get(userId).add(res);
    // Giữ kết nối sống qua proxy / trình duyệt
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* đã đóng */ } }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      const set = clients.get(userId);
      if (set) { set.delete(res); if (!set.size) clients.delete(userId); }
    });
  }

  // topics: những phần dữ liệu vừa đổi, vd ['lich-hen', 'thong-bao']
  function publish(userIds, topics) {
    const data = `data: ${JSON.stringify({ topics })}\n\n`;
    for (const id of new Set(userIds.filter(Boolean))) {
      for (const res of clients.get(id) || []) { try { res.write(data); } catch { /* đã đóng */ } }
    }
  }

  function closeAll() {
    for (const set of clients.values()) for (const res of set) { try { res.end(); } catch { /* bỏ qua */ } }
    clients.clear();
  }

  return { subscribe, publish, closeAll };
}
