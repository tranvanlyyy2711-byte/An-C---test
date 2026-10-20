// GET /api/payment/health — kiểm tra sau khi deploy: Vercel có thật sự chạy thư mục api/ như hàm
// không, và các biến môi trường đã khai đủ chưa.
//
// CHỈ trả lời có/không, KHÔNG bao giờ in ra giá trị khoá.
import { docCauHinh } from '../_lib/payos.mjs';
import { coSupabase } from '../_lib/supabase.mjs';

export default function handler(req, res) {
  const payos = docCauHinh();
  res.status(200).json({
    ok: true,
    chay: 'serverless-function',
    payos: {
      clientId: !!payos.clientId,
      apiKey: !!payos.apiKey,
      checksumKey: !!payos.checksumKey,
      dayDu: payos.san,
    },
    supabase: {
      dayDu: coSupabase(),
      serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
}
