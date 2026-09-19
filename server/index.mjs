// Máy chủ prototype An Cư: phục vụ các trang tĩnh + API lịch xem phòng trên SQLite.
//   npm start                 -> http://localhost:5500
//   PORT=5600 npm start       -> đổi cổng
//   AN_CU_DB=đường/dẫn.sqlite -> đổi file dữ liệu (mặc định data/an-cu.sqlite)
//   AN_CU_NOW=2026-09-19T09:00:00 -> đổi "bây giờ" mô phỏng (mặc định 18/09/2026 08:15,
//                                    cùng mốc với các trang), dùng để thử hết hạn giữ chỗ.
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize, sep, dirname } from 'path';
import { fileURLToPath } from 'url';
import { openDb, ApiError } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const port = Number(process.argv[2] || process.env.PORT || 5500);
const dbFile = process.env.AN_CU_DB || join(root, 'data', 'an-cu.sqlite');
const FIXED_NOW = new Date(process.env.AN_CU_NOW || '2026-09-18T08:15:00');
if (Number.isNaN(FIXED_NOW.getTime())) throw new Error('AN_CU_NOW không hợp lệ: ' + process.env.AN_CU_NOW);

const store = openDb({ file: dbFile, now: () => new Date(FIXED_NOW.getTime()) });

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new ApiError(413, 'too_large', 'Dữ liệu gửi lên quá lớn.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'bad_json', 'Dữ liệu gửi lên không đúng định dạng.')); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  const qs = url.searchParams;
  let id;

  if (p === '/api/suc-khoe' && m === 'GET') return send(res, 200, { ok: true, now: FIXED_NOW.toISOString() });

  // ----- Người thuê -----
  if (p === '/api/lich-xem' && m === 'GET') return send(res, 200, { items: store.listForRenter(qs.get('nguoi')) });
  if (p === '/api/lich-xem' && m === 'POST') return send(res, 201, { item: store.createForRenter(await readJson(req)) });
  if ((id = p.match(/^\/api\/lich-xem\/(\d+)$/)) && m === 'PATCH') {
    const body = await readJson(req);
    if (body.action === 'reschedule') return send(res, 200, { item: store.rescheduleForRenter(id[1], body) });
    if (body.action === 'cancel') return send(res, 200, { item: store.cancelForRenter(id[1], body) });
    throw new ApiError(400, 'bad_action', 'Thao tác không hợp lệ.');
  }
  if (p === '/api/khung-gio' && m === 'GET') {
    return send(res, 200, { taken: store.takenFor({ roomId: qs.get('phong'), date: qs.get('ngay'), nguoi: qs.get('nguoi'), excludeId: qs.get('boQua') }) });
  }

  // ----- Chủ trọ (prototype chưa có đăng nhập: chưa kiểm quyền chủ trọ) -----
  if (p === '/api/chu-tro/lich-xem' && m === 'GET') return send(res, 200, { items: store.listAll() });
  if (p === '/api/chu-tro/lich-xem' && m === 'POST') return send(res, 201, { item: store.createForLandlord(await readJson(req)) });
  if ((id = p.match(/^\/api\/chu-tro\/lich-xem\/(\d+)$/)) && m === 'PATCH') {
    return send(res, 200, { item: store.updateForLandlord(id[1], await readJson(req)) });
  }

  throw new ApiError(404, 'not_found', 'Không có API này.');
}

async function staticFile(req, res, url) {
  let urlPath = decodeURIComponent(url.pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = normalize(join(root, urlPath));
  if (filePath !== root && !filePath.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (filePath.startsWith(join(root, 'data') + sep) || filePath.startsWith(join(root, 'server') + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found: ' + url.pathname);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return staticFile(req, res, url);
  try {
    await api(req, res, url);
  } catch (e) {
    if (e instanceof ApiError) return send(res, e.status, { error: e.code, message: e.message, ...e.extra });
    console.error(e);
    send(res, 500, { error: 'server_error', message: 'Máy chủ gặp lỗi, vui lòng thử lại.' });
  }
});

server.listen(port, () => {
  console.log(`An Cư: http://localhost:${port}  (dữ liệu: ${dbFile}, bây giờ = ${FIXED_NOW.toLocaleString('vi-VN')})`);
});

const stop = () => { server.close(); store.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
