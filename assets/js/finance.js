/* Sổ tài chính phía trình duyệt: doanh thu chủ trọ, quỹ hoa hồng, ví môi giới và yêu cầu rút tiền.
 * Nạp SAU assets/js/data.js.
 *
 * LUẬT CHIA TIỀN — mỗi khoản tiền phòng chủ trọ xác nhận đã nhận:
 *   1. Toàn bộ khoản tiền cộng vào doanh thu của chủ trọ.
 *   2. Trích QUỸ HOA HỒNG = khoản tiền × commission_rate của phòng (mặc định 20%). Phòng không có môi
 *      giới giới thiệu thì không trích.
 *   3. Chia quỹ:
 *        - môi giới giới thiệu phòng: theo BẬC hiệu suất (TIERS, tính theo doanh số tháng đó, gồm cả khoản này)
 *        - tuyến trên (người đã mời môi giới đó, parent_id/upline_id): UPLINE_SHARE của quỹ
 *        - An Cư giữ phần còn lại.
 *   Ví dụ 15.000.000₫, phòng 20%, môi giới Bậc 1 không có tuyến trên: quỹ 3.000.000₫ → môi giới 41% =
 *   1.230.000₫, An Cư 1.770.000₫.
 *
 * VÍ MÔI GIỚI
 *   - Chờ xử lý: hoa hồng của kỳ đang chạy (tháng hiện tại). Chủ trọ còn có thể điều chỉnh.
 *   - Khả dụng: hoa hồng của các kỳ đã kết thúc, trừ số đã yêu cầu rút. Mỗi đầu tháng, phần chờ xử lý
 *     của tháng trước tự chuyển sang khả dụng.
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

  var KEY = 'ancu-tai-chinh-v2';
  var OLD_KEYS = ['ancu-tai-chinh-v1'];
  var SEED_VERSION = 3;
  var MAX_AMOUNT = 1000000000; // chặn gõ nhầm thêm số 0
  var MIN_WITHDRAW = 100000;

  // Bậc hiệu suất theo doanh số (tổng tiền phòng khách đã đóng cho các phòng môi giới giới thiệu) trong tháng
  var TIERS = [
    { level: 1, name: 'Bậc 1', minSales: 0,        share: 0.41 },
    { level: 2, name: 'Bậc 2', minSales: 20000000, share: 0.48 },
    { level: 3, name: 'Bậc 3', minSales: 50000000, share: 0.55 }
  ];
  var UPLINE_SHARE = 0.2; // tuyến trên hưởng 20% quỹ hoa hồng từ giao dịch của tuyến dưới

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

  function empty() { return { version: 2, seedVersion: SEED_VERSION, revenue: {}, commissionFund: {}, payments: [], ledger: [], withdrawals: [] }; }

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
    var parentId = broker.parent_id || broker.upline_id;
    var up = parentId ? D.findUser(parentId) : null;
    if (up && up.role === 'broker' && up.id !== broker.id) {
      q.upline = up; q.uplineShare = UPLINE_SHARE; q.uplineAmount = Math.round(q.commission * UPLINE_SHARE);
    }
    q.platformAmount = q.commission - q.brokerAmount - q.uplineAmount;
    q.net = amt - q.commission;
    return q;
  }

  // Ghi một khoản đã xác nhận vào sổ `s` (không lưu). Dùng chung cho dữ liệu mẫu và thao tác thật.
  function record(s, q, landlordId, period, when, id) {
    var payment = {
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
      payment_amount: q.amount, fund: q.commission, created_at: when };
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

  function migrateSeed(s) {
    var D = data(), seedIds = {};
    D.transactions.forEach(function (t) { if (t.type === 'rent') seedIds[t.id] = true; });
    var manualPayments = s.payments.filter(function (p) { return !seedIds[p.id]; });
    var manualIds = {};
    manualPayments.forEach(function (p) { manualIds[p.id] = true; });
    var migrated = seed();
    manualPayments.forEach(function (p) {
      migrated.payments.push(p);
      add(migrated.revenue, p.landlord_id, Number(p.amount) || 0);
      add(migrated.commissionFund, p.landlord_id, Number(p.commission) || 0);
    });
    s.ledger.forEach(function (entry) {
      if (manualIds[entry.payment_id]) migrated.ledger.push(entry);
    });
    migrated.withdrawals = Array.isArray(s.withdrawals) ? s.withdrawals : [];
    return migrated;
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.version === 2 && s.revenue && Array.isArray(s.payments) && Array.isArray(s.ledger) && Array.isArray(s.withdrawals)) {
        if (s.seedVersion === SEED_VERSION) return s;
        var migrated = migrateSeed(s);
        save(migrated);
        return migrated;
      }
    } catch (e) {}
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
  function quote(contractId, amount) {
    var c = data().findContract(contractId);
    return c ? allocate(load(), c, amount, currentPeriod()) : null;
  }

  function paymentFor(contractId, period) {
    var p = period || currentPeriod();
    return load().payments.filter(function (x) { return x.contract_id === contractId && x.period === p; })[0] || null;
  }

  function confirmPayment(contractId, amount, landlordId) {
    var c = data().findContract(contractId);
    if (!c) return fail('not_found', 'Không tìm thấy hợp đồng.');
    if (c.landlord_id !== landlordId) return fail('forbidden', 'Hợp đồng này không thuộc nhà trọ của bạn.');
    if (c.status !== 'active') return fail('inactive', 'Hợp đồng không còn hiệu lực.');
    if (!Number.isInteger(Number(amount)) || Number(amount) <= 0) return fail('invalid_amount', 'Nhập số tiền đã nhận (số nguyên, lớn hơn 0).');
    if (Number(amount) > MAX_AMOUNT) return fail('invalid_amount', 'Số tiền quá lớn — kiểm tra lại số chữ số 0.');

    // Đọc lại sổ ngay trước khi ghi: tab khác có thể vừa xác nhận cùng kỳ
    var s = load(), period = currentPeriod();
    if (s.payments.some(function (x) { return x.contract_id === contractId && x.period === period; })) {
      return fail('duplicate', 'Kỳ ' + period + ' của hợp đồng này đã được xác nhận rồi.');
    }
    var q = allocate(s, c, amount, period);
    var payment = record(s, q, landlordId, period, new Date().toISOString());
    if (!save(s)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa ghi được.');
    return { ok: true, payment: payment, quote: q };
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
  function ledger(brokerId) {
    var cur = currentPeriod();
    return load().ledger
      .filter(function (e) { return e.broker_id === brokerId; })
      .map(function (e) { var x = {}; for (var k in e) x[k] = e[k]; x.state = e.period < cur ? 'available' : 'pending'; return x; })
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  }

  function withdrawals(brokerId) {
    return load().withdrawals
      .filter(function (w) { return w.broker_id === brokerId; })
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  }

  function wallet(brokerId) {
    var s = load(), cur = currentPeriod();
    var mine = s.ledger.filter(function (e) { return e.broker_id === brokerId; });
    var done = sum(mine.filter(function (e) { return e.period < cur; }), function (e) { return e.amount; });
    var pending = sum(mine.filter(function (e) { return e.period >= cur; }), function (e) { return e.amount; });
    var ws = s.withdrawals.filter(function (w) { return w.broker_id === brokerId && w.status !== 'rejected'; });
    var processing = sum(ws.filter(function (w) { return w.status === 'processing'; }), function (w) { return w.amount; });
    var withdrawn = sum(ws.filter(function (w) { return w.status === 'paid'; }), function (w) { return w.amount; });
    return {
      available: done - processing - withdrawn, pending: pending, processing: processing, withdrawn: withdrawn,
      earned: done + pending, availableFrom: nextPeriodStart(cur)
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
    return data().users.filter(function (u) {
      return u.role === 'broker' && (u.parent_id || u.upline_id) === brokerId;
    });
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
      account_last4: acc.slice(-4), account_name: holder.toUpperCase(),
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
    reset: reset
  };
})(window);
