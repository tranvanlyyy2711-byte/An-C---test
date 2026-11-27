/* Sổ tài chính phía trình duyệt: doanh thu chủ trọ, quỹ hoa hồng, ví môi giới và yêu cầu rút tiền.
 * Nạp SAU assets/js/data.js.
 *
 * LUẬT CHIA TIỀN — mỗi khoản tiền phòng chủ trọ xác nhận đã nhận:
 *   1. Toàn bộ khoản tiền cộng vào doanh thu của chủ trọ.
 *   2. Trích QUỸ HOA HỒNG = khoản tiền × commission_rate của phòng (mặc định 20%). Phòng không có môi
 *      giới giới thiệu thì không trích.
 *   3. Chia quỹ:
 *        - môi giới giới thiệu phòng: theo BẬC hiệu suất (TIERS, tính theo doanh số tháng đó, gồm cả khoản này)
 *        - tuyến trên (F1 — người đã mời môi giới đó, parent_id/upline_id): UPLINE_SHARE (20%) của phần môi giới F2
 *          nhận được. Tiền này lấy từ phần An Cư giữ, F2 không bị trừ đồng nào.
 *        - An Cư giữ phần còn lại.
 *   Ví dụ 15.000.000₫, phòng 20%, môi giới Bậc 1 không có tuyến trên: quỹ 3.000.000₫ → môi giới 41% =
 *   1.230.000₫, An Cư 1.770.000₫. Nếu môi giới đó có tuyến trên: tuyến trên thêm 20% × 1.230.000₫ =
 *   246.000₫, An Cư còn 1.524.000₫.
 *
 * KỲ THANH TOÁN: mỗi tháng của hợp đồng là một kỳ (Kỳ 1 = tháng bắt đầu hợp đồng). Chủ trọ xác nhận được
 *   kỳ hiện tại hoặc kỳ đã qua (khi môi giới gửi yêu cầu đối soát), không xác nhận trước kỳ tương lai.
 *
 * VÍ MÔI GIỚI
 *   - Chờ xử lý: hoa hồng DỰ KIẾN của các kỳ đã tới hạn mà chủ trọ chưa xác nhận đã thu tiền (hợp đồng do
 *     môi giới giới thiệu, và hợp đồng của tuyến dưới). Ước theo tiền thuê tháng × tỷ lệ quỹ hiện tại × bậc
 *     tháng này — chưa phải tiền thật, không rút được.
 *   - Khả dụng: chủ trọ bấm "Xác nhận đã thu tiền" kỳ nào thì hoa hồng kỳ đó được chia và vào thẳng ví
 *     khả dụng (rời khỏi ví chờ xử lý), trừ số đã yêu cầu rút.
 *   - Rút tiền: chỉ GHI NHẬN yêu cầu (trạng thái 'processing'), An Cư duyệt và chuyển khoản thủ công —
 *     bản demo không chuyển tiền thật.
 *
 * Toàn bộ nằm trong MỘT khoá localStorage để một lần ghi là trọn vẹn. Lần đầu mở, sổ được dựng lại từ
 * các khoản tiền phòng đã thu trong data.js theo đúng luật trên.
 *
 * Chỉ là mô phỏng: ai mở DevTools cũng sửa được localStorage. Khi lên Supabase, phần ghi này phải là
 * MỘT giao dịch CSDL (RPC) ở máy chủ, kiểm quyền — không để trình duyệt tự cộng ví hay tự duyệt rút tiền.
 */
(function (global) {
  'use strict';

  // v3: tuyến trên hưởng 20% hoa hồng của F2 (v2 là 5% quỹ). Sổ v2 được chia lại theo luật mới khi mở lần đầu.
  var KEY = 'ancu-tai-chinh-v3';
  var V2_KEY = 'ancu-tai-chinh-v2';
  var OLD_KEYS = ['ancu-tai-chinh-v1', V2_KEY];
  // Tăng khi dữ liệu mẫu trong data.js đổi cách gán hoa hồng (vd hợp đồng đổi mã môi giới): sổ được dựng lại
  // từ dữ liệu mẫu mới, giữ nguyên các lần chủ trọ xác nhận / An Cư cưỡng chế và các lệnh rút tiền.
  var SEED_VERSION = 6;
  // Tuyến trên của một môi giới: parent_id (tên mới) hoặc upline_id (tên cũ) — data.js khai cả hai
  function parentOf(u) { return u ? (u.parent_id || u.upline_id || null) : null; }
  var MAX_AMOUNT = 1000000000; // chặn gõ nhầm thêm số 0
  var MIN_WITHDRAW = 100000;

  // Bậc hiệu suất theo doanh số (tổng tiền phòng khách đã đóng cho các phòng môi giới giới thiệu) trong tháng
  var TIERS = [
    { level: 1, name: 'Bậc 1', minSales: 0,        share: 0.41 },
    { level: 2, name: 'Bậc 2', minSales: 20000000, share: 0.48 },
    { level: 3, name: 'Bậc 3', minSales: 50000000, share: 0.55 }
  ];
  var UPLINE_SHARE = 0.2; // tuyến trên (F1) hưởng 20% phần hoa hồng tuyến dưới (F2) nhận, lấy từ phần của An Cư

  function data() {
    if (!global.AnCuData) throw new Error('finance.js: chưa nạp assets/js/data.js');
    return global.AnCuData;
  }

  function currentPeriod(date) {
    var o = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit' })
      .formatToParts(date || new Date()).forEach(function (p) { o[p.type] = p.value; });
    return o.year + '-' + o.month;
  }
  // Ngày đầu kỳ sau, dạng 'YYYY-MM-DD' — mốc hoa hồng chờ xử lý chuyển sang khả dụng
  function nextPeriodStart(period) {
    var a = period.split('-').map(Number), y = a[0], m = a[1] + 1;
    if (m > 12) { m = 1; y += 1; }
    return y + '-' + ('0' + m).slice(-2) + '-01';
  }

  function tierFor(sales) {
    var t = TIERS[0];
    TIERS.forEach(function (x) { if (sales >= x.minSales) t = x; });
    var next = TIERS.filter(function (x) { return x.level === t.level + 1; })[0] || null;
    return { tier: t, next: next, sales: sales };
  }

  function add(map, key, n) { if (key) map[key] = (map[key] || 0) + n; }
  function sum(list, f) { return list.reduce(function (s, x) { return s + (f ? f(x) : x); }, 0); }
  function newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function empty() { return { version: 3, seedVersion: SEED_VERSION, revenue: {}, commissionFund: {}, payments: [], ledger: [], withdrawals: [] }; }

  /* ---------- Kỳ thanh toán của hợp đồng ---------- */
  function addMonths(period, n) {
    var a = period.split('-').map(Number), t = a[0] * 12 + (a[1] - 1) + n;
    return Math.floor(t / 12) + '-' + ('0' + (t % 12 + 1)).slice(-2);
  }
  // Số thứ tự kỳ: Kỳ 1 là tháng bắt đầu hợp đồng
  function kyOf(contract, period) {
    var s = contract.start_date.slice(0, 7).split('-').map(Number), p = period.split('-').map(Number);
    return (p[0] - s[0]) * 12 + (p[1] - s[1]) + 1;
  }
  // Các kỳ đã tới hạn của hợp đồng: từ tháng bắt đầu tới tháng hiện tại (không quá tháng kết thúc)
  function periodsOf(contract) {
    var last = currentPeriod(), end = contract.end_date.slice(0, 7);
    if (end < last) last = end;
    var list = [], p = contract.start_date.slice(0, 7);
    while (p <= last && list.length < 120) { list.push(p); p = addMonths(p, 1); }
    return list;
  }

  function salesIn(s, brokerId, period) {
    return sum(s.payments.filter(function (p) { return p.broker_id === brokerId && p.period === period; }), function (p) { return p.amount; });
  }

  // Tính cách chia cho một khoản tiền, dựa trên sổ `s` hiện có (để biết doanh số tháng của môi giới)
  function allocate(s, contract, amount, period) {
    var D = data();
    var room = D.findRoom(contract.room_id);
    // Ai mang khách này về thì người đó hưởng: mã trên hợp đồng (từ link affiliate khách đã dùng) đứng
    // trước mã gắn với phòng
    var broker = D.findBrokerByRef(contract.ref_code || (room && room.ref_code));
    var amt = Math.max(0, Math.round(Number(amount) || 0));
    var q = {
      contract: contract, room: room, broker: broker, refCode: broker ? broker.ref_code : null,
      amount: amt, rate: 0, commission: 0, tier: null, brokerShare: 0, brokerAmount: 0,
      upline: null, uplineShare: 0, uplineAmount: 0, platformAmount: 0, net: amt, salesAfter: 0
    };
    if (!broker) return q;
    q.rate = D.commissionRateOf(room);
    q.commission = D.commissionFor(amt, room);
    q.salesAfter = salesIn(s, broker.id, period) + amt;
    q.tier = tierFor(q.salesAfter).tier;
    q.brokerShare = q.tier.share;
    q.brokerAmount = Math.round(q.commission * q.brokerShare);
    var up = parentOf(broker) ? D.findUser(parentOf(broker)) : null;
    if (up && up.role === 'broker' && up.id !== broker.id) {
      q.upline = up; q.uplineShare = UPLINE_SHARE; q.uplineAmount = Math.round(q.brokerAmount * UPLINE_SHARE);
    }
    q.platformAmount = q.commission - q.brokerAmount - q.uplineAmount;
    q.net = amt - q.commission;
    return q;
  }

  // Ghi một khoản đã xác nhận vào sổ `s` (không lưu). Dùng chung cho dữ liệu mẫu và thao tác thật.
  // extra (không bắt buộc): { forced_by, dispute_id } khi quản trị cưỡng chế duyệt theo khiếu nại
  function record(s, q, landlordId, period, when, id, extra) {
    var payment = {
      forced_by: extra && extra.forced_by || null, dispute_id: extra && extra.dispute_id || null,
      id: id || newId('pay-'), contract_id: q.contract.id, room_id: q.room ? q.room.id : null, landlord_id: landlordId,
      period: period, amount: q.amount, rate: q.rate, commission: q.commission,
      ref_code: q.refCode, broker_id: q.broker ? q.broker.id : null,
      tier: q.tier ? q.tier.level : null, broker_share: q.brokerShare, broker_amount: q.brokerAmount,
      upline_id: q.upline ? q.upline.id : null, upline_amount: q.uplineAmount, platform_amount: q.platformAmount,
      confirmed_at: when
    };
    add(s.revenue, landlordId, q.amount);
    if (q.commission > 0) add(s.commissionFund, landlordId, q.commission);
    s.payments.push(payment);
    var base = { payment_id: payment.id, period: period, room_id: payment.room_id, contract_id: payment.contract_id,
      payment_amount: q.amount, fund: q.commission, created_at: when, forced: !!payment.forced_by };
    function entry(extra) { var e = { id: payment.id + ':' + extra.kind }; for (var k in base) e[k] = base[k]; for (var j in extra) e[j] = extra[j]; s.ledger.push(e); }
    if (q.brokerAmount > 0) entry({ kind: 'direct', broker_id: q.broker.id, ref_code: q.refCode, share: q.brokerShare, tier: q.tier.level, amount: q.brokerAmount });
    if (q.uplineAmount > 0) entry({ kind: 'upline', broker_id: q.upline.id, ref_code: q.upline.ref_code, from_broker_id: q.broker.id, share: q.uplineShare, amount: q.uplineAmount });
    return payment;
  }

  // Sổ khởi đầu: chia lại từ các khoản tiền phòng đã thu trong data.js, theo thứ tự thời gian
  function seed() {
    var s = empty(), D = data();
    D.transactions
      .filter(function (t) { return t.type === 'rent' && t.status === 'paid'; })
      .sort(function (a, b) { return String(a.paid_at).localeCompare(String(b.paid_at)); })
      .forEach(function (t) {
        var c = D.findContract(t.contract_id);
        if (!c) return;
        record(s, allocate(s, c, t.amount, t.period), t.to_id, t.period, t.paid_at, t.id);
      });
    return s;
  }

  function valid(s, version) {
    return s && s.version === version && s.revenue && Array.isArray(s.payments) && Array.isArray(s.ledger) && Array.isArray(s.withdrawals);
  }

  // Dựng lại sổ từ dữ liệu mẫu hiện hành + luật chia hiện hành, giữ các lần xác nhận làm tay (kể cả khoản
  // An Cư cưỡng chế) và các lệnh rút tiền của sổ cũ. Dùng cho sổ v2 (luật 5% quỹ) và sổ v3 có seedVersion cũ.
  function rebuild(v2) {
    var s = seed(), D = data();
    var seeded = {};
    s.payments.forEach(function (p) { seeded[p.id] = true; });
    var kySeed = {};
    s.payments.forEach(function (p) { kySeed[p.contract_id + '|' + p.period] = true; });
    v2.payments
      .filter(function (p) { return !seeded[p.id] && !kySeed[p.contract_id + '|' + p.period]; })
      .sort(function (a, b) { return String(a.confirmed_at).localeCompare(String(b.confirmed_at)); })
      .forEach(function (p) {
        var c = D.findContract(p.contract_id);
        if (c) record(s, allocate(s, c, p.amount, p.period), p.landlord_id, p.period, p.confirmed_at, p.id,
          p.forced_by ? { forced_by: p.forced_by, dispute_id: p.dispute_id } : null);
      });
    s.withdrawals = v2.withdrawals.slice();
    return s;
  }

  function load() {
    var s;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (valid(s, 3)) {
      if (s.seedVersion === SEED_VERSION) return s;
      s = rebuild(s); save(s); return s;
    }
    var v2;
    try { v2 = JSON.parse(localStorage.getItem(V2_KEY) || 'null'); } catch (e) { v2 = null; }
    if (valid(v2, 2)) { s = rebuild(v2); save(s); return s; }
    return seed();
  }
  function save(s) {
    try {
      s.seedVersion = SEED_VERSION;
      localStorage.setItem(KEY, JSON.stringify(s));
      OLD_KEYS.forEach(function (k) { localStorage.removeItem(k); }); // sổ v1 chia tiền theo luật cũ
      return true;
    } catch (e) { return false; }
  }

  function fail(error, message, field) { return { ok: false, error: error, message: message, field: field || null }; }

  /* ---------- Chủ trọ ---------- */
  function quote(contractId, amount, period) {
    var c = data().findContract(contractId);
    return c ? allocate(load(), c, amount, period || currentPeriod()) : null;
  }

  function paymentFor(contractId, period) {
    var p = period || currentPeriod();
    return load().payments.filter(function (x) { return x.contract_id === contractId && x.period === p; })[0] || null;
  }

  // period (không bắt buộc, 'YYYY-MM'): kỳ được xác nhận. Mặc định là kỳ hiện tại; kỳ đã qua dùng khi
  // môi giới gửi yêu cầu đối soát. Kỳ phải nằm trong thời hạn hợp đồng và không ở tương lai.
  function confirmPayment(contractId, amount, landlordId, period) {
    var c = data().findContract(contractId);
    if (!c) return fail('not_found', 'Không tìm thấy hợp đồng.');
    if (c.landlord_id !== landlordId) return fail('forbidden', 'Hợp đồng này không thuộc nhà trọ của bạn.');
    if (c.status !== 'active') return fail('inactive', 'Hợp đồng không còn hiệu lực.');
    period = period ? String(period) : currentPeriod();
    if (periodsOf(c).indexOf(period) === -1) {
      return fail('invalid_period', period > currentPeriod() ? 'Kỳ này chưa tới, chưa xác nhận được.' : 'Kỳ này nằm ngoài thời hạn hợp đồng.');
    }
    if (!Number.isInteger(Number(amount)) || Number(amount) <= 0) return fail('invalid_amount', 'Nhập số tiền đã nhận (số nguyên, lớn hơn 0).');
    if (Number(amount) > MAX_AMOUNT) return fail('invalid_amount', 'Số tiền quá lớn — kiểm tra lại số chữ số 0.');

    // Đọc lại sổ ngay trước khi ghi: tab khác có thể vừa xác nhận cùng kỳ
    var s = load();
    if (s.payments.some(function (x) { return x.contract_id === contractId && x.period === period; })) {
      return fail('duplicate', 'Kỳ ' + kyOf(c, period) + ' (' + period.split('-').reverse().join('/') + ') của hợp đồng này đã được xác nhận rồi.');
    }
    var q = allocate(s, c, amount, period);
    var payment = record(s, q, landlordId, period, new Date().toISOString());
    if (!save(s)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa ghi được.');
    kiemF1(q);
    return { ok: true, payment: payment, quote: q };
  }

  // Doanh số vừa tăng → kiểm lại điều kiện mở khoá quyền Trưởng nhóm F1 (assets/js/moi-gioi.js, nạp sau file này)
  function kiemF1(q) {
    if (q.broker && global.AnCuMoiGioi && global.AnCuMoiGioi.f1Check) global.AnCuMoiGioi.f1Check(q.broker.id);
  }

  /* ---------- Quản trị ---------- */
  // admin: id tài khoản trong dữ liệu mẫu, hoặc { id, role } lấy từ phiên đăng nhập (components/nguoi-dung.js)
  function isAdmin(a) { var u = a && typeof a === 'object' ? a : data().findUser(a); return !!u && u.role === 'admin'; }
  function idOf(a) { return a && typeof a === 'object' ? a.id : a; }

  // Trọng tài: quản trị đã kiểm chứng từ và kết luận khách ĐÃ đóng tiền kỳ đó cho chủ trọ, nhưng chủ trọ
  // không bấm xác nhận. Ghi kỳ đó như chủ trọ đã thu (doanh thu thuộc chủ trọ), chia hoa hồng theo luật thường,
  // đánh dấu forced_by + dispute_id để mọi bên thấy đây là quyết định của An Cư chứ không phải chủ trọ bấm.
  function forceConfirm(contractId, period, amount, adminId, disputeId) {
    if (!isAdmin(adminId)) return fail('forbidden', 'Chỉ quản trị An Cư mới cưỡng chế duyệt được.');
    var c = data().findContract(contractId);
    if (!c) return fail('not_found', 'Không tìm thấy hợp đồng.');
    if (periodsOf(c).indexOf(period) === -1) return fail('invalid_period', 'Kỳ này chưa tới hoặc nằm ngoài thời hạn hợp đồng.');
    amount = Number(amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return fail('invalid_amount', 'Số tiền khách đã đóng không hợp lệ.');
    var s = load();
    if (s.payments.some(function (x) { return x.contract_id === contractId && x.period === period; })) {
      return fail('duplicate', 'Chủ trọ đã xác nhận kỳ này rồi, không cần cưỡng chế.');
    }
    var q = allocate(s, c, amount, period);
    var payment = record(s, q, c.landlord_id, period, new Date().toISOString(), null, { forced_by: idOf(adminId), dispute_id: disputeId || null });
    if (!save(s)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa ghi được.');
    kiemF1(q);
    return { ok: true, payment: payment, quote: q };
  }

  // Duyệt lệnh rút tiền: 'paid' (đã chuyển khoản, bắt buộc mã giao dịch) | 'rejected' (bắt buộc lý do,
  // tiền trả lại ví khả dụng). Chỉ lệnh đang 'processing' mới xử lý được.
  function decideWithdrawal(id, action, adminId, input) {
    if (!isAdmin(adminId)) return fail('forbidden', 'Chỉ quản trị An Cư mới duyệt lệnh rút tiền.');
    var s = load();
    var w = s.withdrawals.filter(function (x) { return x.id === id; })[0];
    if (!w) return fail('not_found', 'Không tìm thấy lệnh rút tiền.');
    if (w.status !== 'processing') return fail('closed', 'Lệnh này đã được xử lý.');
    input = input || {};
    if (action === 'paid') {
      var ref = String(input.transferRef || '').trim().replace(/\s+/g, ' ');
      if (ref.length < 4 || ref.length > 60) return fail('ref_required', 'Nhập mã giao dịch chuyển khoản (4–60 ký tự) để đối soát sau này.', 'ref');
      w.status = 'paid'; w.transfer_ref = ref;
    } else if (action === 'rejected') {
      var why = String(input.reason || '').trim().replace(/\s+/g, ' ');
      if (why.length < 5 || why.length > 300) return fail('reason_required', 'Ghi lý do từ chối (5–300 ký tự) để môi giới biết.', 'reason');
      w.status = 'rejected'; w.reject_note = why;
    } else return fail('invalid_action', 'Thao tác không hợp lệ.');
    w.decided_by = idOf(adminId); w.decided_at = new Date().toISOString();
    if (!save(s)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa ghi được.');
    return { ok: true, withdrawal: w };
  }

  function allWithdrawals() {
    return load().withdrawals.slice().sort(function (a, b) {
      return (a.status === 'processing' ? 0 : 1) - (b.status === 'processing' ? 0 : 1) || String(b.created_at).localeCompare(String(a.created_at));
    });
  }

  function summary(landlordId) {
    var s = load();
    var revenue = s.revenue[landlordId] || 0, fund = s.commissionFund[landlordId] || 0;
    return { revenue: revenue, commissionFund: fund, net: revenue - fund };
  }

  function payments(landlordId) {
    return load().payments
      .filter(function (p) { return !landlordId || p.landlord_id === landlordId; })
      .sort(function (a, b) { return String(b.confirmed_at).localeCompare(String(a.confirmed_at)); });
  }

  /* ---------- Môi giới ---------- */
  // Mọi khoản trong sổ đều đã được chủ trọ xác nhận thu tiền → khả dụng
  function ledger(brokerId) {
    return load().ledger
      .filter(function (e) { return e.broker_id === brokerId; })
      .map(function (e) { var x = {}; for (var k in e) x[k] = e[k]; x.state = 'available'; return x; })
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  }

  /* ---------- Kỳ cần thu & hoa hồng dự kiến ---------- */
  // Các kỳ cần theo dõi của hợp đồng: từ kỳ đầu tiên đã được xác nhận (hoặc từ Kỳ 1 nếu chưa có kỳ nào)
  // tới kỳ hiện tại. Kỳ trước lần xác nhận đầu tiên thường là trước khi có sổ, không tính.
  function windowPeriods(contract, s) {
    s = s || load();
    var all = periodsOf(contract);
    var paid = {};
    s.payments.forEach(function (p) { if (p.contract_id === contract.id) paid[p.period] = p; });
    var first = -1;
    all.forEach(function (p, i) { if (first === -1 && paid[p]) first = i; });
    return all.slice(first === -1 ? 0 : first).map(function (p) { return { period: p, ky: kyOf(contract, p), payment: paid[p] || null }; });
  }

  // Hoa hồng dự kiến của các kỳ đã tới hạn chưa xác nhận, dành cho môi giới `brokerId`
  function projected(brokerId) {
    var D = data(), s = load(), out = [];
    var share = {};
    function shareOf(id) { if (!(id in share)) share[id] = tierFor(salesIn(s, id, currentPeriod())).tier.share; return share[id]; }
    D.contracts.filter(function (c) { return c.status === 'active'; }).forEach(function (c) {
      var room = D.findRoom(c.room_id);
      var b = D.findBrokerByRef(c.ref_code || (room && room.ref_code));
      if (!b) return;
      var up = parentOf(b) ? D.findUser(parentOf(b)) : null;
      var mine = b.id === brokerId, asUpline = up && up.id === brokerId && up.role === 'broker';
      if (!mine && !asUpline) return;
      windowPeriods(c, s).filter(function (k) { return !k.payment; }).forEach(function (k) {
        var direct = Math.round(D.commissionFor(c.monthly_rent, room) * shareOf(b.id));
        out.push({
          contract_id: c.id, room_id: c.room_id, period: k.period, ky: k.ky, kind: mine ? 'direct' : 'upline',
          from_broker_id: mine ? null : b.id, amount: mine ? direct : Math.round(direct * UPLINE_SHARE)
        });
      });
    });
    return out;
  }

  function withdrawals(brokerId) {
    return load().withdrawals
      .filter(function (w) { return w.broker_id === brokerId; })
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  }

  function wallet(brokerId) {
    var s = load();
    var done = sum(s.ledger.filter(function (e) { return e.broker_id === brokerId; }), function (e) { return e.amount; });
    var du = projected(brokerId);
    var ws = s.withdrawals.filter(function (w) { return w.broker_id === brokerId && w.status !== 'rejected'; });
    var processing = sum(ws.filter(function (w) { return w.status === 'processing'; }), function (w) { return w.amount; });
    var withdrawn = sum(ws.filter(function (w) { return w.status === 'paid'; }), function (w) { return w.amount; });
    return {
      available: done - processing - withdrawn, pending: sum(du, function (x) { return x.amount; }), pendingCount: du.length,
      processing: processing, withdrawn: withdrawn, earned: done
    };
  }

  // Doanh số tháng và bậc hiện tại của môi giới
  function performance(brokerId, period) {
    var p = period || currentPeriod();
    var r = tierFor(salesIn(load(), brokerId, p));
    r.period = p;
    r.progress = r.next ? Math.min(1, (r.sales - r.tier.minSales) / (r.next.minSales - r.tier.minSales)) : 1;
    r.toNext = r.next ? Math.max(0, r.next.minSales - r.sales) : 0;
    return r;
  }

  function downlines(brokerId) {
    return data().users.filter(function (u) { return u.role === 'broker' && parentOf(u) === brokerId; });
  }

  // Số liệu một môi giới mang về: doanh số (tiền phòng khách đã đóng) và hoa hồng trực tiếp, từ trước tới nay
  function brokerStats(brokerId) {
    var s = load();
    var mine = s.payments.filter(function (p) { return p.broker_id === brokerId; });
    return {
      sales: sum(mine, function (p) { return p.amount; }),
      direct: sum(mine, function (p) { return p.broker_amount; }),
      payments: mine.length
    };
  }

  var BANKS = ['Vietcombank', 'VietinBank', 'BIDV', 'Agribank', 'Techcombank', 'MB Bank', 'ACB', 'VPBank', 'TPBank', 'Sacombank'];

  function requestWithdrawal(brokerId, input) {
    var u = data().findUser(brokerId);
    if (!u || u.role !== 'broker') return fail('forbidden', 'Chỉ tài khoản môi giới mới rút tiền được.');
    var amount = Number(input.amount);
    var bank = String(input.bank || '');
    var acc = String(input.accountNo || '').replace(/\s+/g, '');
    var holder = String(input.accountName || '').trim().replace(/\s+/g, ' ');
    if (!Number.isInteger(amount) || amount <= 0) return fail('invalid_amount', 'Nhập số tiền muốn rút.', 'amount');
    if (amount < MIN_WITHDRAW) return fail('too_small', 'Số tiền rút tối thiểu là ' + new Intl.NumberFormat('vi-VN').format(MIN_WITHDRAW) + '₫.', 'amount');
    if (BANKS.indexOf(bank) === -1) return fail('invalid_bank', 'Chọn ngân hàng nhận tiền.', 'bank');
    if (!/^\d{6,19}$/.test(acc)) return fail('invalid_account', 'Số tài khoản gồm 6–19 chữ số.', 'accountNo');
    if (holder.length < 2) return fail('invalid_holder', 'Nhập tên chủ tài khoản.', 'accountName');

    var s = load();
    var w = wallet(brokerId); // đọc lại ngay trước khi ghi
    if (amount > w.available) return fail('insufficient', 'Ví khả dụng chỉ còn ' + new Intl.NumberFormat('vi-VN').format(w.available) + '₫.', 'amount');
    var req = {
      id: newId('rt-'), broker_id: brokerId, amount: amount, bank: bank,
      // Số tài khoản đầy đủ để quản trị chuyển khoản (giao diện môi giới chỉ hiện 4 số cuối)
      account_no: acc, account_last4: acc.slice(-4), account_name: holder.toUpperCase(),
      status: 'processing', created_at: new Date().toISOString()
    };
    s.withdrawals.push(req);
    if (!save(s)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa ghi được.');
    return { ok: true, withdrawal: req };
  }

  function reset() { try { localStorage.removeItem(KEY); OLD_KEYS.forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} }

  global.AnCuFinance = {
    STORAGE_KEY: KEY,
    TIERS: TIERS,
    UPLINE_SHARE: UPLINE_SHARE,
    MIN_WITHDRAW: MIN_WITHDRAW,
    BANKS: BANKS,
    currentPeriod: currentPeriod,
    nextPeriodStart: nextPeriodStart,
    kyOf: kyOf,
    periodsOf: periodsOf,
    windowPeriods: windowPeriods,
    projected: projected,
    brokerStats: brokerStats,
    tierFor: tierFor,
    quote: quote,
    confirmPayment: confirmPayment,
    paymentFor: paymentFor,
    summary: summary,
    payments: payments,
    ledger: ledger,
    wallet: wallet,
    withdrawals: withdrawals,
    performance: performance,
    downlines: downlines,
    requestWithdrawal: requestWithdrawal,
    decideWithdrawal: decideWithdrawal,
    allWithdrawals: allWithdrawals,
    forceConfirm: forceConfirm,
    reset: reset
  };
})(window);
