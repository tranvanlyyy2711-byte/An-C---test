# Deploy An Cư miễn phí

Prototype hiện tại có hai phần, và chọn chỗ host phụ thuộc vào việc cần phần nào:

| Phần | Cần gì để chạy | Host tĩnh (Vercel) có chạy được không |
|---|---|---|
| Trang HTML + `components/*.js` | Chỉ phục vụ file | Có |
| `server/index.mjs` (đăng nhập SQLite, lịch xem một khung giờ một người, SSE, hỗ trợ, quản trị, thêm phòng) | Node ≥ 22.5 (`node:sqlite`), **chạy liên tục**, **ổ đĩa giữ được file** `Trang admin/an-cu.sqlite` | Không — serverless không giữ file và không giữ kết nối SSE |
| `api/payment/*.mjs` (payOS) | Serverless Function + Supabase | Có |

Máy chủ không có dependency nào ngoài Node, nên chỗ nào chạy được `node server/index.mjs` là deploy được.

> Điều khoản gói miễn phí của các nhà cung cấp thay đổi thường xuyên. Kiểm tra lại trang giá trước khi làm.

---

## Đề xuất

- **Bản xem thử công khai (luôn có):** Vercel + Supabase — phương án A, đã cấu hình sẵn.
- **Bản chạy thật cho nhóm / chấm bài, cần dữ liệu dùng chung:**
  - Cần ngay hôm nay, chạy vài giờ → **B. Cloudflare Tunnel** từ máy mình.
  - Cần link sống lâu, dữ liệu không mất → **C. Oracle Cloud Always Free VM**.
  - Chỉ cần link sống lâu, chấp nhận dữ liệu tự reset về mẫu → **D. Render free**.

---

## A. Vercel + Supabase (bản xem thử — đã có)

Dùng `vercel.json` + `.vercelignore` hiện tại. Đăng nhập thật qua Supabase Auth, còn phòng / lịch xem / hợp đồng
là dữ liệu mẫu trên từng trình duyệt (xem mục "Đăng nhập thật trên bản Vercel" trong `CLAUDE.md`).

1. vercel.com → Add New Project → import repo GitHub, Framework Preset **Other**, không đổi Build/Output.
2. Supabase (supabase.com, gói Free): chạy lần lượt `supabase/migrations/0001…0003` trong SQL Editor;
   **tắt "Confirm email"** (Authentication › Providers › Email).
3. Điền URL + anon key vào `components/cau-hinh-supabase.js`, commit.
4. Vercel › Settings › Environment Variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (khoá công khai, giống
   `cau-hinh-supabase.js`), `SUPABASE_SERVICE_ROLE_KEY`, và nếu dùng tiền thật thì `PAYOS_CLIENT_ID`,
   `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY`. Redeploy.
5. Mở `/api/payment/health` — `supabase.dayDu: true` là đủ biến.

Bản đang chạy: https://an-cu-delta.vercel.app (project `titmit/an-cu`). Deploy lại từ máy:
`npx vercel deploy --prod`. Muốn mỗi lần push GitHub tự deploy thì nối GitHub vào tài khoản Vercel rồi chạy
`npx vercel git connect`.

Giới hạn: Supabase Free tạm dừng dự án sau ~1 tuần không có truy cập (vào Dashboard bấm Restore là chạy lại).

---

## B. Cloudflare Tunnel từ máy mình (nhanh nhất, không cần thẻ)

Đưa đúng máy chủ đang chạy ở `localhost:5500` ra một link HTTPS công khai. Đủ tính năng, dữ liệu là SQLite trên
máy mình. Máy tắt hoặc đóng cửa sổ là link chết.

```powershell
winget install --id Cloudflare.cloudflared

# Cửa sổ 1 — máy chủ (giữ mở)
npm start

# Cửa sổ 2 — tunnel (giữ mở), in ra https://<ten-ngau-nhien>.trycloudflare.com
cloudflared tunnel --url http://localhost:5500
```

Muốn link payOS quay về đúng chỗ thì đặt origin trước khi `npm start`:

```powershell
$env:AN_CU_ORIGIN = "https://<ten-ngau-nhien>.trycloudflare.com"; npm start
```

Link `trycloudflare.com` đổi mỗi lần chạy lại `cloudflared`. Muốn link cố định thì cần một tên miền đã trỏ về
Cloudflare và tạo *named tunnel* (`cloudflared tunnel create an-cu`).

Vì có link công khai thật, payOS gọi được webhook vào máy (`/api/payment/webhook`) — điều localhost không làm được.

---

## C. Oracle Cloud Always Free VM (bền nhất, miễn phí lâu dài)

Một máy ảo luôn bật, có ổ đĩa riêng, nên SQLite giữ nguyên qua mọi lần khởi động lại. Cần thẻ quốc tế để xác
minh (không trừ tiền nếu chỉ dùng tài nguyên Always Free). Phương án thay thế tương đương: Google Cloud
`e2-micro` free tier.

### 1. Tạo máy

- Compute › Instances › Create: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** (Ampere, Always Free)
  1 OCPU / 6 GB là đủ. Tải khoá SSH về.
- Networking › VCN › Security List: mở cổng **80** và **443** (TCP, nguồn `0.0.0.0/0`).
- Trong máy: `sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save`
  (image Ubuntu của Oracle chặn sẵn ở iptables).

### 2. Cài và chạy

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git sqlite3
sudo git clone https://github.com/tranvanlyyy2711-byte/An-C---test.git /opt/an-cu
sudo chown -R ubuntu:ubuntu /opt/an-cu
cd /opt/an-cu && npm ci --omit=dev
```

`/opt/an-cu/.env.local` (không commit):

```
PORT=5500
AN_CU_ORIGIN=https://<ten>.duckdns.org
AN_CU_DB=/var/lib/an-cu/an-cu.sqlite
# PAYOS_CLIENT_ID=  PAYOS_API_KEY=  PAYOS_CHECKSUM_KEY=   # bỏ trống = chế độ mô phỏng
```

```bash
sudo mkdir -p /var/lib/an-cu && sudo chown ubuntu:ubuntu /var/lib/an-cu
```

`/etc/systemd/system/an-cu.service`:

```ini
[Unit]
Description=An Cu prototype
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/opt/an-cu
EnvironmentFile=/opt/an-cu/.env.local
ExecStart=/usr/bin/node server/index.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now an-cu
curl -s localhost:5500/trang-chu.html | head -5
```

### 3. Tên miền + HTTPS miễn phí

- duckdns.org: tạo `<ten>.duckdns.org` trỏ về IP công khai của VM.
- Caddy tự xin chứng chỉ Let's Encrypt:

```bash
sudo apt install -y caddy
echo '<ten>.duckdns.org {
  reverse_proxy localhost:5500
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy chuyển tiếp SSE mà không cần cấu hình thêm.

### 4. Sao lưu và cập nhật

```bash
# crontab -e — sao lưu 3h sáng mỗi ngày, giữ 14 bản
0 3 * * * sqlite3 /var/lib/an-cu/an-cu.sqlite ".backup /var/lib/an-cu/bk-$(date +\%F).sqlite" && ls -t /var/lib/an-cu/bk-*.sqlite | tail -n +15 | xargs -r rm
```

Cập nhật code: `cd /opt/an-cu && git pull && sudo systemctl restart an-cu`.

---

## D. Render free (link cố định, dữ liệu không bền)

Render chạy được Node, có HTTPS và link `*.onrender.com` cố định, nhưng gói free **không có ổ đĩa bền** và
**ngủ sau ~15 phút không có truy cập**. Mỗi lần ngủ dậy hoặc deploy lại, file SQLite mất và máy chủ seed lại
dữ liệu mẫu. Hợp để giảng viên bấm thử, không hợp để nhóm nhập dữ liệu thật. Lần mở đầu sau khi ngủ chờ ~30–60 giây.

- New › Web Service › chọn repo, Runtime **Node**.
- Build Command: `npm ci --omit=dev` · Start Command: `node server/index.mjs`.
- Environment: `NODE_VERSION=24`, `AN_CU_ORIGIN=https://<ten>.onrender.com` (Render tự cấp `PORT`, máy chủ đã
  đọc biến này).

---

## So sánh nhanh

| | A. Vercel + Supabase | B. Cloudflare Tunnel | C. Oracle VM | D. Render free |
|---|---|---|---|---|
| Đủ tính năng máy chủ | Không (chỉ đăng nhập + payOS) | Có | Có | Có |
| Dữ liệu dùng chung, giữ lâu | Chỉ tài khoản | Khi máy mình bật | Có | Mất khi ngủ/deploy |
| Link cố định | Có | Không (trừ khi có tên miền) | Có | Có |
| Luôn bật | Có | Khi máy mình bật | Có | Ngủ sau 15 phút |
| Cần thẻ | Không | Không | Có (xác minh) | Không |
| Công sức | Đã xong | 5 phút | 1–2 giờ | 15 phút |

## Không nên dùng

- **GitHub Pages / Netlify / Cloudflare Pages** thay Vercel: phục vụ được trang tĩnh nhưng không chạy
  `api/payment/*.mjs` theo đúng dạng hiện tại — phải viết lại hàm.
- **Fly.io, Railway**: không còn gói miễn phí lâu dài cho tài khoản mới (chỉ có tiền dùng thử).
- Gắn SQLite vào serverless (Vercel/Netlify Functions): mỗi lần gọi có thể là một máy khác, ghi xong là mất.
