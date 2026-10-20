/* Địa chỉ dự án Supabase dùng cho đăng ký / đăng nhập thật.
 *
 * Khoá dưới đây là khoá CÔNG KHAI (publishable / anon) — Supabase thiết kế để nhúng thẳng vào trình
 * duyệt, nên đưa vào file tĩnh là đúng cách. Nó chỉ làm được những gì RLS cho phép, vì vậy mọi bảng
 * BẮT BUỘC bật RLS (xem supabase/migrations/0001_profiles.sql). Khoá service_role thì KHÔNG BAO GIỜ
 * được để ở đây hay bất kỳ file nào trình duyệt tải về.
 *
 * Đổi dự án Supabase thì sửa hai dòng này rồi deploy lại; để trống thì cả trang tự quay về chế độ
 * xem thử (components/phien-xem-thu.js).
 */
window.CAU_HINH_SUPABASE = {
  url: 'https://yhhehlnqftwyzxgluqud.supabase.co',
  khoaCongKhai: 'sb_publishable_K_npNsQ0LL9JwU-DS9nzmg_c862SW2W'
};
