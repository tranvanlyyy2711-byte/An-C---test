// Phòng do CHÍNH chủ trọ tự thêm — bảng thật trong SQLite, mỗi dòng gắn một landlord_id.
//
// Khác với dữ liệu mẫu của Nhà trọ An Bình (khai cứng trong server/phong.mjs để demo), đây là chỗ
// lưu phòng mà người dùng tạo bằng nút "+ Thêm phòng". Mọi truy vấn đều lọc theo landlord_id lấy từ
// PHIÊN ĐĂNG NHẬP, không bao giờ lấy từ tham số do trình duyệt gửi lên — xem server/index.mjs.
//
// Bản trên Vercel không có máy chủ này: trang ghi thẳng vào bảng rooms của Supabase, cô lập bằng RLS
// (supabase/migrations/0003_rooms.sql). Hai nơi cùng một mô hình dữ liệu.

export const PHONG_SCHEMA = `
CREATE TABLE IF NOT EXISTS landlord_rooms (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  landlord_id    TEXT    NOT NULL,
  code           TEXT    NOT NULL,              -- mã/tên phòng: P.101, P.102…
  floor          INTEGER NOT NULL DEFAULT 1,
  price          INTEGER NOT NULL,              -- VND/tháng, số nguyên
  deposit        INTEGER NOT NULL DEFAULT 0,
  electric_start INTEGER NOT NULL DEFAULT 0,    -- kWh
  water_start    INTEGER NOT NULL DEFAULT 0,    -- m³
  status         TEXT    NOT NULL DEFAULT 'vacant'
                 CHECK (status IN ('vacant','rented','deposit','leaving')),
  tenant_name    TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL
);
-- Mã phòng không trùng trong phạm vi MỘT chủ trọ; hai chủ trọ khác nhau được đặt trùng mã.
CREATE UNIQUE INDEX IF NOT EXISTS one_code_per_landlord ON landlord_rooms (landlord_id, code);
CREATE INDEX IF NOT EXISTS idx_room_landlord ON landlord_rooms (landlord_id, floor, code);
`;

const MA_HOP_LE = /^[A-Za-z0-9][A-Za-z0-9. \-_/]{0,19}$/;

export function createPhongChuTro(db, ApiError, now) {
  db.exec(PHONG_SCHEMA);

  const q = {
    them: db.prepare(`INSERT INTO landlord_rooms
      (landlord_id, code, floor, price, deposit, electric_start, water_start, status, tenant_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)`),
    cuaChu: db.prepare('SELECT * FROM landlord_rooms WHERE landlord_id = ? ORDER BY floor, code'),
    theoId: db.prepare('SELECT * FROM landlord_rooms WHERE id = ?'),
    xoa: db.prepare('DELETE FROM landlord_rooms WHERE id = ? AND landlord_id = ?'),
    demTheoChu: db.prepare('SELECT COUNT(*) AS n FROM landlord_rooms WHERE landlord_id = ?'),
  };

  function item(r) {
    return {
      id: r.id, code: r.code, floor: r.floor, price: r.price, deposit: r.deposit,
      electricStart: r.electric_start, waterStart: r.water_start,
      status: r.status, tenant: r.tenant_name || null, createdAt: r.created_at,
      tuThem: true,                        // để giao diện phân biệt với phòng mẫu
    };
  }

  function soNguyen(v, ten, { min = 0, max = 2000000000, batBuoc = false } = {}) {
    if (v === '' || v === null || v === undefined) {
      if (batBuoc) throw new ApiError(400, 'thieu_' + ten, 'Vui lòng nhập ' + ten + '.', { field: ten });
      return 0;
    }
    const n = Number(String(v).replace(/[^\d-]/g, ''));
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new ApiError(400, 'sai_' + ten, ten + ' phải là số nguyên.', { field: ten });
    }
    if (n < min || n > max) {
      throw new ApiError(400, 'sai_' + ten, ten + ' nằm ngoài khoảng cho phép.', { field: ten });
    }
    return n;
  }

  /** Danh sách phòng của chính chủ trọ đang đăng nhập. */
  function danhSach(landlordId) {
    return q.cuaChu.all(String(landlordId)).map(item);
  }

  /** Thêm một phòng. landlordId LUÔN lấy từ phiên, không nhận từ body. */
  function them(landlordId, body = {}) {
    const chu = String(landlordId || '');
    if (!chu) throw new ApiError(401, 'login_required', 'Vui lòng đăng nhập bằng tài khoản chủ trọ.');

    const code = String(body.code || '').trim();
    if (!code) throw new ApiError(400, 'thieu_ma_phong', 'Vui lòng nhập mã phòng (ví dụ: P.101).', { field: 'code' });
    if (!MA_HOP_LE.test(code)) {
      throw new ApiError(400, 'sai_ma_phong', 'Mã phòng chỉ gồm chữ, số, dấu chấm hoặc gạch, tối đa 20 ký tự.', { field: 'code' });
    }

    const floor = soNguyen(body.floor === undefined ? 1 : body.floor, 'floor', { min: 0, max: 100 }) || 1;
    const price = soNguyen(body.price, 'price', { min: 1, max: 2000000000, batBuoc: true });
    const deposit = soNguyen(body.deposit, 'deposit', { min: 0 });
    const dien = soNguyen(body.electricStart, 'electricStart', { min: 0, max: 10000000 });
    const nuoc = soNguyen(body.waterStart, 'waterStart', { min: 0, max: 10000000 });
    const TRANG_THAI = new Set(['vacant', 'rented', 'deposit', 'leaving']);
    const status = TRANG_THAI.has(body.status) ? body.status : 'vacant';

    try {
      const r = q.them.run(chu, code, floor, price, deposit, dien, nuoc, status, now().toISOString());
      return item(q.theoId.get(r.lastInsertRowid));
    } catch (e) {
      if (/UNIQUE constraint failed/i.test(String(e && e.message))) {
        throw new ApiError(409, 'trung_ma_phong', 'Bạn đã có phòng mang mã ' + code + '. Hãy dùng mã khác.', { field: 'code' });
      }
      throw e;
    }
  }

  function xoa(landlordId, id) {
    const r = q.theoId.get(Number(id));
    if (!r) throw new ApiError(404, 'phong_khong_co', 'Không tìm thấy phòng này.');
    if (r.landlord_id !== String(landlordId)) throw new ApiError(403, 'not_owner', 'Phòng này không thuộc tài khoản của bạn.');
    q.xoa.run(Number(id), String(landlordId));
    return { ok: true };
  }

  /** Số phòng tự thêm, để cộng vào ô "Tổng số phòng" dùng chung với khu quản trị. */
  function dem(landlordId) {
    const ds = danhSach(landlordId);
    const dangThue = ds.filter((r) => r.status === 'rented' || r.status === 'leaving').length;
    return { rooms: ds.length, rented: dangThue, items: ds };
  }

  return { danhSach, them, xoa, dem };
}
