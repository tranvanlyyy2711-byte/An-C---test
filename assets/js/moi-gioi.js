/* Khách môi giới giới thiệu + yêu cầu đối soát thanh toán, phía trình duyệt.
 * Nạp SAU assets/js/data.js, assets/js/bookings.js và assets/js/finance.js.
 *
 * KHÁCH HÀNG — mỗi lịch xem phòng có mã môi giới (ref_code, gắn từ link ?ref=) là một khách của môi giới đó.
 * Bốn bước, chỉ đi tới, không lùi:
 *   da-dat-lich  Đã đặt lịch      — hệ thống tự ghi khi khách đặt lịch qua link của môi giới
 *   da-xem       Đã xem phòng     — chủ trọ HOẶC môi giới xác nhận, sau giờ hẹn, với lịch đã được chủ trọ nhận
 *                                   (lịch chủ trọ đánh dấu "Đã xem xong" thì tự sang bước này)
 *   da-coc       Đã cọc           — chỉ chủ trọ xác nhận, sau khi khách đã xem
 *   da-ky        Đã ký hợp đồng   — chỉ chủ trọ xác nhận, sau khi khách đã xem (có thể bỏ qua bước cọc)
 *   Lịch bị huỷ / từ chối khi khách chưa xem thì khách đó dừng lại ("Lịch đã huỷ").
 *   localStorage 'ancu-khach-moi-gioi-v1' = { [bookingId]: { stage, history: [{ stage, by_id, by_role, at }] } }
 *
 * ĐỐI SOÁT — môi giới thấy các kỳ tiền phòng của hợp đồng mình giới thiệu. Kỳ đã tới mà chủ trọ chưa xác
 * nhận nhận tiền thì môi giới gửi yêu cầu đối soát; chủ trọ xác nhận đã nhận tiền kỳ đó (hoa hồng chia
 * ngay) hoặc từ chối kèm lý do. Kỳ đã có xác nhận thì yêu cầu tự coi là xong.
 *   localStorage 'ancu-doi-soat-v1' = [{ id, broker_id, contract_id, landlord_id, period, ky, note,
 *                                        status: 'open' | 'rejected', reject_note, created_at, decided_at }]
 *
 * Chỉ là mô phỏng: localStorage là kho riêng của từng trình duyệt và ai cũng sửa được. Khi lên Supabase,
 * kiểm quyền (môi giới / chủ trọ của lịch) phải nằm ở máy chủ.
 */
(function (global) {
  'use strict';

  var KEY_KHACH = 'ancu-khach-moi-gioi-v1';
  var KEY_DOI_SOAT = 'ancu-doi-soat-v1';

  var STAGES = [
    { key: 'da-dat-lich', label: 'Đã đặt lịch',    who: 'Hệ thống tự động',               tone: 'b-mute' },
    { key: 'da-xem',      label: 'Đã xem phòng',   who: 'Chủ trọ hoặc môi giới xác nhận', tone: 'b-info' },
    { key: 'da-coc',      label: 'Đã cọc',         who: 'Chủ trọ xác nhận',               tone: 'b-warn' },
    { key: 'da-ky',       label: 'Đã ký hợp đồng', who: 'Chủ trọ xác nhận',               tone: 'b-ok' }
  ];
  var CLOSED = { key: 'da-huy', label: 'Lịch đã huỷ', who: 'Khách chưa xem phòng', tone: 'b-danger' };
  // Khách hẹn xem rồi không đến — chủ trọ xác nhận, tính 1 vi phạm "bùng lịch" cho môi giới (điều kiện uy tín F1)
  var NO_SHOW = { key: 'bung-lich', label: 'Khách bùng lịch', who: 'Chủ trọ xác nhận khách không đến', tone: 'b-danger' };

  function D() { return global.AnCuData; }
  function F() { return global.AnCuFinance; }
  function B() { return global.AnCuBookings; }
  function stageIndex(key) { for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === key) return i; return -1; }
  function readJson(k, fallback) {
    try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function fail(error, message, field) { return { ok: false, error: error, message: message, field: field || null }; }
  function norm(code) { return String(code || '').trim().toUpperCase(); }
  function nowIso() { return new Date().toISOString(); }

  /* ---------- Khách hàng ---------- */
  function store() { var s = readJson(KEY_KHACH, {}); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; }

  function view(b, saved) {
    var room = D().findRoom(b.room_id);
    var renter = b.renter_id ? D().findUser(b.renter_id) : null;
    var rec = saved[b.id] || null;
    var key = rec && stageIndex(rec.stage) !== -1 ? rec.stage
      : stageIndex(b.stage) !== -1 ? b.stage                       // bước khởi đầu khai trong dữ liệu mẫu (data.js)
      : (b.status === 'completed' ? 'da-xem' : 'da-dat-lich');
    var idx = stageIndex(key);
    var noShow = !!(rec && rec.no_show);
    var closed = noShow || (idx === 0 && (b.status === 'cancelled' || b.status === 'rejected'));
    var history = rec && Array.isArray(rec.history) ? rec.history.slice() : [];
    if (!rec && b.stage && stageIndex(b.stage) > 0) history.push({ stage: b.stage, by_role: 'landlord', at: b.stage_at || b.scheduled_at });
    else if (!rec && key === 'da-xem') history.push({ stage: 'da-xem', by_role: 'system', at: b.scheduled_at });
    var last = history.length ? history[history.length - 1] : null;
    return {
      booking: b, room: room, renter: renter,
      name: (renter && renter.name) || b.renter_name || 'Khách',
      phone: renter ? renter.phone : '',
      broker: D().findBrokerByRef(norm(b.ref_code)),
      landlord: D().findUser(b.landlord_id),
      stage: noShow ? NO_SHOW : closed ? CLOSED : STAGES[idx], stageIndex: closed ? -1 : idx, closed: closed, noShow: noShow,
      history: history, last: last
    };
  }

  function withRef() {
    return B().all().filter(function (b) { return !!norm(b.ref_code); });
  }
  function customersOfBroker(brokerId) {
    var me = D().findUser(brokerId);
    if (!me || me.role !== 'broker') return [];
    var saved = store();
    return withRef().filter(function (b) { return norm(b.ref_code) === me.ref_code; })
      .map(function (b) { return view(b, saved); })
      .sort(function (a, b) { return String(b.booking.scheduled_at).localeCompare(String(a.booking.scheduled_at)); });
  }
  function customersOfLandlord(landlordId) {
    var saved = store();
    return withRef().filter(function (b) { return b.landlord_id === landlordId; })
      .map(function (b) { return view(b, saved); })
      .sort(function (a, b) { return String(b.booking.scheduled_at).localeCompare(String(a.booking.scheduled_at)); });
  }

  // Các bước người dùng `user` được bấm tiếp cho khách `c` (để giao diện vẽ nút)
  function nextSteps(c, user) {
    if (!user || c.closed) return [];
    var isLandlord = user.role === 'landlord' && c.booking.landlord_id === user.id;
    var isBroker = user.role === 'broker' && c.broker && c.broker.id === user.id;
    var out = [];
    if (c.stageIndex === 0 && (isLandlord || isBroker)) out.push('da-xem');
    if (c.stageIndex === 0 && isLandlord) out.push('bung-lich');
    if (isLandlord && c.stageIndex === 1) out.push('da-coc', 'da-ky');
    if (isLandlord && c.stageIndex === 2) out.push('da-ky');
    return out;
  }

  // Lý do chưa bấm được "Đã xem phòng" (null = bấm được)
  function viewBlocker(b) {
    if (b.status === 'pending') return 'Chủ trọ chưa nhận lịch này.';
    if (b.status === 'proposed') return 'Chủ trọ đang đề xuất giờ khác, chưa chốt lịch.';
    if (b.status === 'cancelled' || b.status === 'rejected') return 'Lịch xem đã huỷ.';
    if (Date.parse(b.scheduled_at) > Date.now()) return 'Buổi xem chưa diễn ra.';
    return null;
  }

  function advance(bookingId, stage, user) {
    if (!user) return fail('login_required', 'Vui lòng đăng nhập.');
    var b = B().all().filter(function (x) { return x.id === bookingId; })[0];
    if (!b || !norm(b.ref_code)) return fail('not_found', 'Không tìm thấy khách do môi giới giới thiệu.');
    var target = stageIndex(stage);
    if (target < 1) return fail('invalid_stage', 'Bước không hợp lệ.');
    var saved = store(), c = view(b, saved);
    if (nextSteps(c, user).indexOf(stage) === -1) {
      if (user.role === 'broker' && target > 1) return fail('forbidden', 'Chỉ chủ trọ mới xác nhận khách đã cọc hoặc đã ký hợp đồng.');
      if (c.closed) return fail('closed', 'Lịch xem đã huỷ, không cập nhật được.');
      if (target <= c.stageIndex) return fail('already', 'Khách đã ở bước "' + c.stage.label + '" rồi.');
      if (target > 1 && c.stageIndex < 1) return fail('order', 'Cần xác nhận khách đã xem phòng trước.');
      return fail('forbidden', 'Bạn không có quyền cập nhật khách này.');
    }
    if (stage === 'da-xem') { var lyDo = viewBlocker(b); if (lyDo) return fail('not_yet', lyDo); }
    var rec = saved[b.id] || { stage: c.stage.key, history: c.history };
    rec.stage = stage;
    rec.history = (rec.history || []).concat([{ stage: stage, by_id: user.id, by_role: user.role, at: nowIso() }]);
    saved[b.id] = rec;
    if (!writeJson(KEY_KHACH, saved)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa ghi được.');
    // Chủ trọ xác nhận "Đã ký hợp đồng" → thêm một hợp đồng chốt thành công cho môi giới, kiểm lại quyền F1
    if (stage === 'da-ky' && c.broker) f1Check(c.broker.id);
    return { ok: true, customer: view(b, saved) };
  }

  /* ---------- Đối soát thanh toán ---------- */
  function requestsRaw() { var l = readJson(KEY_DOI_SOAT, []); return Array.isArray(l) ? l : []; }

  function brokerOfContract(c) {
    var room = D().findRoom(c.room_id);
    return D().findBrokerByRef(c.ref_code || (room && room.ref_code));
  }
  function contractsOfBroker(brokerId) {
    return D().contracts.filter(function (c) {
      var b = brokerOfContract(c);
      return c.status === 'active' && b && b.id === brokerId;
    });
  }

  function requestView(r) {
    var c = D().findContract(r.contract_id);
    var paid = c ? F().paymentFor(c.id, r.period) : null;
    var x = {}; for (var k in r) x[k] = r[k];
    x.contract = c; x.room = c ? D().findRoom(c.room_id) : null; x.payment = paid;
    x.state = paid ? 'done' : r.status; // done | open | rejected
    return x;
  }

  // Kỳ của một hợp đồng, dành cho môi giới:
  //   done    — chủ trọ đã xác nhận nhận tiền (đã chia hoa hồng)
  //   open    — đã tới hạn, chưa xác nhận, gửi được yêu cầu đối soát (kỳ sau kỳ đã đối soát gần nhất)
  //   asked   — đang có yêu cầu đối soát chờ chủ trọ
  // Các kỳ chưa xác nhận NẰM TRƯỚC kỳ đã đối soát đầu tiên không liệt kê (thường là trước khi môi giới tham gia).
  function periodsForBroker(contract) {
    var reqs = requestsRaw().filter(function (r) { return r.contract_id === contract.id; }).map(requestView);
    return F().windowPeriods(contract).map(function (k) {
      var p = k.period;
      var open = reqs.filter(function (r) { return r.period === p && r.state === 'open'; })[0] || null;
      var rejected = reqs.filter(function (r) { return r.period === p && r.state === 'rejected'; }).sort(function (a, b) {
        return String(b.created_at).localeCompare(String(a.created_at)); })[0] || null;
      return {
        period: p, ky: k.ky, payment: k.payment,
        state: k.payment ? 'done' : open ? 'asked' : 'open', request: open || rejected
      };
    });
  }

  // Yêu cầu đối soát đang mở của một kỳ (cho trang chủ trọ hiện ngay cạnh nút xác nhận)
  function openRequestFor(contractId, period) {
    return requestsRaw().filter(function (r) { return r.contract_id === contractId && r.period === period; })
      .map(requestView).filter(function (r) { return r.state === 'open'; })[0] || null;
  }

  function requestReconcile(brokerId, contractId, period, note) {
    var me = D().findUser(brokerId);
    if (!me || me.role !== 'broker') return fail('forbidden', 'Chỉ môi giới mới gửi được yêu cầu đối soát.');
    var c = D().findContract(contractId);
    if (!c || contractsOfBroker(brokerId).indexOf(c) === -1) return fail('forbidden', 'Hợp đồng này không do bạn giới thiệu.', 'contract');
    var ky = periodsForBroker(c).filter(function (x) { return x.period === period; })[0];
    if (!ky) return fail('invalid_period', 'Chọn một kỳ đã tới hạn của hợp đồng.', 'period');
    if (ky.state === 'done') return fail('done', 'Kỳ ' + ky.ky + ' đã được chủ trọ xác nhận, không cần đối soát.', 'period');
    if (ky.state === 'asked') return fail('duplicate', 'Kỳ ' + ky.ky + ' đang chờ chủ trọ xử lý yêu cầu trước.', 'period');
    note = String(note || '').trim().replace(/\s+/g, ' ');
    if (note.length > 300) return fail('too_long', 'Ghi chú tối đa 300 ký tự.', 'note');
    var list = requestsRaw();
    var r = {
      id: 'ds-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      broker_id: brokerId, contract_id: c.id, landlord_id: c.landlord_id, room_id: c.room_id,
      period: period, ky: ky.ky, note: note, status: 'open', reject_note: '', created_at: nowIso(), decided_at: null
    };
    list.push(r);
    if (!writeJson(KEY_DOI_SOAT, list)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa gửi được.');
    return { ok: true, request: requestView(r) };
  }

  function rejectReconcile(id, landlordId, reason) {
    var list = requestsRaw();
    var r = list.filter(function (x) { return x.id === id; })[0];
    if (!r) return fail('not_found', 'Không tìm thấy yêu cầu đối soát.');
    if (r.landlord_id !== landlordId) return fail('forbidden', 'Yêu cầu này không thuộc nhà trọ của bạn.');
    if (requestView(r).state !== 'open') return fail('closed', 'Yêu cầu này đã được xử lý.');
    reason = String(reason || '').trim().replace(/\s+/g, ' ');
    if (reason.length < 5) return fail('reason_required', 'Ghi lý do từ chối (ít nhất 5 ký tự) để môi giới biết.', 'reason');
    if (reason.length > 300) return fail('too_long', 'Lý do tối đa 300 ký tự.', 'reason');
    r.status = 'rejected'; r.reject_note = reason; r.decided_at = nowIso();
    if (!writeJson(KEY_DOI_SOAT, list)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa ghi được.');
    return { ok: true, request: requestView(r) };
  }

  function requestsOfBroker(brokerId) {
    return requestsRaw().filter(function (r) { return r.broker_id === brokerId; }).map(requestView)
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  }
  function requestsOfLandlord(landlordId) {
    return requestsRaw().filter(function (r) { return r.landlord_id === landlordId; }).map(requestView)
      .sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
  }

  /* ---------- Khiếu nại lên An Cư (trọng tài đối soát) ----------
   * Môi giới đã nhắc chủ trọ (yêu cầu đối soát) mà chủ trọ vẫn không xác nhận, dù khách đã đóng tiền kỳ đó.
   * Môi giới gửi chứng từ (ảnh biên lai/sao kê + số tiền, ngày đóng, mã giao dịch); quản trị kiểm tra rồi:
   *   force    — cưỡng chế duyệt: AnCuFinance.forceConfirm ghi kỳ đó, chia hoa hồng vào Ví khả dụng
   *   rejected — bác khiếu nại (bắt buộc lý do)
   * Chủ trọ tự xác nhận kỳ đó trước khi quản trị xử lý thì khiếu nại tự đóng ('auto').
   *   localStorage 'ancu-khieu-nai-v1' = [{ id, broker_id, contract_id, landlord_id, room_id, period, ky, amount,
   *     paid_date, tx_ref, note, evidence (ảnh data URL đã thu nhỏ | null), status: 'open'|'forced'|'rejected',
   *     decision_note, decided_by, decided_at, created_at }]
   */
  var KEY_KHIEU_NAI = 'ancu-khieu-nai-v1';
  var MAX_EVIDENCE = 900000; // ~900 KB chuỗi data URL, để vừa localStorage
  function disputesRaw() { var l = readJson(KEY_KHIEU_NAI, []); return Array.isArray(l) ? l : []; }
  function disputeView(d) {
    var c = D().findContract(d.contract_id), pay = c ? F().paymentFor(c.id, d.period) : null;
    var x = {}; for (var k in d) x[k] = d[k];
    x.contract = c; x.room = c ? D().findRoom(c.room_id) : null; x.payment = pay;
    x.broker = D().findUser(d.broker_id); x.landlord = D().findUser(d.landlord_id);
    x.state = d.status === 'open' && pay ? 'auto' : d.status;
    return x;
  }
  function byNewest(a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }
  function disputesOfBroker(brokerId) { return disputesRaw().filter(function (d) { return d.broker_id === brokerId; }).map(disputeView).sort(byNewest); }
  function allDisputes() {
    return disputesRaw().map(disputeView).sort(function (a, b) { return (a.state === 'open' ? 0 : 1) - (b.state === 'open' ? 0 : 1) || byNewest(a, b); });
  }
  function openDisputeFor(contractId, period) {
    return disputesRaw().map(disputeView).filter(function (d) { return d.contract_id === contractId && d.period === period && d.state === 'open'; })[0] || null;
  }

  function fileDispute(brokerId, input) {
    var me = D().findUser(brokerId);
    if (!me || me.role !== 'broker') return fail('forbidden', 'Chỉ môi giới mới gửi được khiếu nại.');
    var c = D().findContract(input.contractId);
    if (!c || contractsOfBroker(brokerId).indexOf(c) === -1) return fail('forbidden', 'Hợp đồng này không do bạn giới thiệu.', 'contract');
    var ky = periodsForBroker(c).filter(function (k) { return k.period === input.period; })[0];
    if (!ky) return fail('invalid_period', 'Chọn một kỳ đã tới hạn của hợp đồng.', 'period');
    if (ky.state === 'done') return fail('done', 'Chủ trọ đã xác nhận kỳ ' + ky.ky + ', không cần khiếu nại.', 'period');
    if (!ky.request) return fail('need_request', 'Gửi yêu cầu đối soát cho chủ trọ trước; chủ trọ không xử lý thì mới khiếu nại lên An Cư.', 'period');
    if (openDisputeFor(c.id, input.period)) return fail('duplicate', 'Kỳ ' + ky.ky + ' đã có khiếu nại đang chờ An Cư xử lý.', 'period');
    var amount = Number(String(input.amount || '').replace(/[^0-9]/g, ''));
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1000000000) return fail('invalid_amount', 'Nhập số tiền khách đã đóng.', 'amount');
    var paidDate = String(input.paidDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || paidDate > new Date().toISOString().slice(0, 10)) return fail('invalid_date', 'Chọn ngày khách đã đóng (không sau hôm nay).', 'paidDate');
    var tx = String(input.txRef || '').trim().replace(/\s+/g, ' ');
    var ev = input.evidence || null;
    if (ev && (typeof ev !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(ev))) return fail('invalid_file', 'Chứng từ phải là ảnh JPG, PNG hoặc WEBP.', 'evidence');
    if (ev && ev.length > MAX_EVIDENCE) return fail('file_too_big', 'Ảnh chứng từ quá lớn, hãy chọn ảnh khác.', 'evidence');
    if (!ev && tx.length < 4) return fail('need_evidence', 'Cần ảnh chứng từ hoặc mã giao dịch chuyển khoản để An Cư kiểm tra.', 'evidence');
    if (tx.length > 60) return fail('too_long', 'Mã giao dịch tối đa 60 ký tự.', 'txRef');
    var note = String(input.note || '').trim().replace(/\s+/g, ' ');
    if (note.length > 500) return fail('too_long', 'Mô tả tối đa 500 ký tự.', 'note');
    var list = disputesRaw();
    var d = {
      id: 'kn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      broker_id: brokerId, contract_id: c.id, landlord_id: c.landlord_id, room_id: c.room_id, period: input.period, ky: ky.ky,
      amount: amount, paid_date: paidDate, tx_ref: tx, note: note, evidence: ev,
      status: 'open', decision_note: '', decided_by: null, decided_at: null, created_at: nowIso()
    };
    list.push(d);
    if (!writeJson(KEY_KHIEU_NAI, list)) return fail('storage', 'Bộ nhớ trình duyệt đã đầy hoặc bị chặn, chưa gửi được. Thử ảnh nhỏ hơn.', 'evidence');
    return { ok: true, dispute: disputeView(d) };
  }

  // action: 'force' (cưỡng chế duyệt quỹ hoa hồng) | 'rejected' (bác). note: kết luận của quản trị (bắt buộc).
  function decideDispute(id, action, adminId, note) {
    var admin = adminId && typeof adminId === 'object' ? adminId : D().findUser(adminId);
    if (!admin || admin.role !== 'admin') return fail('forbidden', 'Chỉ quản trị An Cư mới xử lý khiếu nại.');
    var list = disputesRaw(), d = list.filter(function (x) { return x.id === id; })[0];
    if (!d) return fail('not_found', 'Không tìm thấy khiếu nại.');
    var v = disputeView(d);
    if (v.state !== 'open') return fail('closed', v.state === 'auto' ? 'Chủ trọ đã tự xác nhận kỳ này, khiếu nại đã đóng.' : 'Khiếu nại này đã được xử lý.');
    note = String(note || '').trim().replace(/\s+/g, ' ');
    if (note.length < 5 || note.length > 500) return fail('note_required', 'Ghi kết luận kiểm tra chứng từ (5–500 ký tự) — môi giới và chủ trọ đều thấy.', 'note');
    var payment = null;
    if (action === 'force') {
      var kq = F().forceConfirm(d.contract_id, d.period, d.amount, adminId, d.id);
      if (!kq.ok) return kq;
      payment = kq.payment;
      d.status = 'forced';
    } else if (action === 'rejected') d.status = 'rejected';
    else return fail('invalid_action', 'Thao tác không hợp lệ.');
    d.decision_note = note; d.decided_by = admin.id; d.decided_at = nowIso();
    if (!writeJson(KEY_KHIEU_NAI, list)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa ghi được.');
    return { ok: true, dispute: disputeView(d), payment: payment };
  }

  /* ---------- Quyền Trưởng nhóm F1 (mở khoá tuyển dụng tuyến dưới) ----------
   * Môi giới mới đăng ký chưa được tuyển F2 (is_f1_unlocked = false). Mở khoá khi đạt đủ 3 điều kiện:
   *   1. Chốt thành công F1_HOP_DONG (3) hợp đồng: hợp đồng mang mã của môi giới (data.js) + khách chủ trọ đã
   *      xác nhận "Đã ký hợp đồng" ở sổ khách (bước da-ky). Không đếm hợp đồng của tuyến dưới.
   *   2. Doanh số tích luỹ >= F1_DOANH_SO (10.000.000₫) = tiền phòng khách của chính môi giới đã đóng và được
   *      ghi vào sổ (AnCuFinance.brokerStats) + tiền phòng tháng đầu của mỗi hợp đồng mới chủ trọ xác nhận đã ký
   *      (sổ khách chưa sinh khoản tiền trong sổ tài chính, nên không bị đếm hai lần).
   *   3. Uy tín: điểm >= 4.5/5 và 0 vi phạm (tin rác hoặc bùng lịch). Chưa có hệ thống đánh giá nên điểm mặc định 5.0.
   *      Tin rác: quản trị ghi ở quan-tri/tong-quan.html#moi-gioi. Bùng lịch: chủ trọ bấm "Khách bùng lịch" với khách
   *      do môi giới giới thiệu (markNoShow), hoặc quản trị ghi tay. violations[].type = 'tin-rac' | 'bung-lich'.
   * Kiểm lại mỗi khi chủ trọ xác nhận thu tiền / đã ký hợp đồng, An Cư cưỡng chế duyệt, và khi môi giới mở trang.
   * Đã mở thì giữ (lưu thời điểm mở + đã hiện lời chúc mừng chưa). Ba F1 mẫu trong data.js có sẵn quyền.
   *   localStorage 'ancu-f1-mo-khoa-v1' = { [brokerId]: { unlocked_at, celebrated } }
   *   localStorage 'ancu-uy-tin-mg-v1'  = { [brokerId]: { rating, violations: [{ at, by, note }] } }
   * Chống đa cấp biến tướng: chỉ mã của tài khoản đã mở khoá mới mời được F2 (canRecruit) — trang đăng ký kiểm. */
  var KEY_F1 = 'ancu-f1-mo-khoa-v1', KEY_UY_TIN = 'ancu-uy-tin-mg-v1';
  var F1_HOP_DONG = 3, F1_DOANH_SO = 10000000, F1_DIEM = 4.5, DIEM_MAC_DINH = 5;
  function objStore(k) { var o = readJson(k, {}); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; }

  function uyTin(brokerId) {
    var r = objStore(KEY_UY_TIN)[brokerId] || {};
    var rating = typeof r.rating === 'number' ? r.rating : DIEM_MAC_DINH;
    var vp = Array.isArray(r.violations) ? r.violations : [];
    var bung = vp.filter(function (v) { return v.type === 'bung-lich'; }).length;
    return { rating: rating, rated: typeof r.rating === 'number', violations: vp.length, tinRac: vp.length - bung, bungLich: bung,
      list: vp, ok: rating >= F1_DIEM && vp.length === 0 };
  }

  function hopDongChot(brokerId) {
    var keys = {}, giaTri = 0;
    D().contracts.forEach(function (c) {
      var b = brokerOfContract(c);
      if (b && b.id === brokerId && (c.status === 'active' || c.status === 'ended')) keys['hd:' + c.id] = true;
    });
    customersOfBroker(brokerId).forEach(function (k) {
      if (k.stage.key !== 'da-ky') return;
      // Khách nối với một hợp đồng đã có: hợp đồng đó đã được đếm, tiền phòng của nó đã nằm trong sổ tài chính
      if (k.booking.contract_id) { keys['hd:' + k.booking.contract_id] = true; return; }
      keys['bk:' + k.booking.id] = true; giaTri += (k.room && k.room.price) || 0;
    });
    return { count: Object.keys(keys).length, firstMonth: giaTri };
  }

  function isUnlocked(brokerId) {
    var u = D().findUser(brokerId);
    return !!u && u.role === 'broker' && (u.is_f1_unlocked === true || !!objStore(KEY_F1)[brokerId]);
  }

  function f1Status(brokerId) {
    var u = D().findUser(brokerId), rec = objStore(KEY_F1)[brokerId] || null;
    var chot = hopDongChot(brokerId), hd = chot.count, ds = F().brokerStats(brokerId).sales + chot.firstMonth, ut = uyTin(brokerId);
    var conds = [
      { key: 'hop-dong', label: 'Chốt thành công ' + F1_HOP_DONG + ' hợp đồng thuê phòng', cur: hd, target: F1_HOP_DONG, ok: hd >= F1_HOP_DONG, unit: 'hd' },
      { key: 'doanh-so', label: 'Tổng doanh số phòng tích luỹ đạt ' + new Intl.NumberFormat('vi-VN').format(F1_DOANH_SO) + '₫', cur: ds, target: F1_DOANH_SO, ok: ds >= F1_DOANH_SO, unit: 'vnd' },
      { key: 'uy-tin', label: 'Điểm uy tín từ ' + F1_DIEM.toFixed(1) + '/5.0 sao & không vi phạm tin rác / bùng lịch', cur: ut.rating, target: 5, ok: ut.ok, unit: 'sao',
        violations: ut.violations, tinRac: ut.tinRac, bungLich: ut.bungLich, rated: ut.rated }
    ];
    return {
      unlocked: isUnlocked(brokerId), grandfathered: !!(u && u.is_f1_unlocked === true),
      unlockedAt: rec ? rec.unlocked_at : null, celebrated: rec ? !!rec.celebrated : true,
      conds: conds, allOk: conds.every(function (c) { return c.ok; })
    };
  }

  // Đạt đủ điều kiện mà chưa mở → mở khoá. Trả về true nếu VỪA mở trong lần gọi này.
  function f1Check(brokerId) {
    if (!brokerId || isUnlocked(brokerId)) return false;
    var u = D().findUser(brokerId);
    if (!u || u.role !== 'broker' || !f1Status(brokerId).allOk) return false;
    var all = objStore(KEY_F1);
    all[brokerId] = { unlocked_at: nowIso(), celebrated: false };
    return writeJson(KEY_F1, all);
  }
  function f1MarkCelebrated(brokerId) {
    var all = objStore(KEY_F1);
    if (all[brokerId] && !all[brokerId].celebrated) { all[brokerId].celebrated = true; writeJson(KEY_F1, all); }
  }

  // Mã này có được dùng làm link tuyển dụng (?invite=) không. Trả về { ok, broker, error, message }.
  function canRecruit(code) {
    var b = D().findBrokerByRef(norm(code));
    if (!b) return { ok: false, broker: null, error: 'not_found', message: 'Mã giới thiệu không tồn tại.' };
    if (!isUnlocked(b.id)) return { ok: false, broker: b, error: 'not_unlocked', message: 'Mã giới thiệu chưa kích hoạt quyền tuyển dụng.' };
    return { ok: true, broker: b };
  }

  function recordViolation(brokerId, admin, note, type) {
    if (!admin || admin.role !== 'admin') return fail('forbidden', 'Chỉ quản trị An Cư mới ghi vi phạm.');
    note = String(note || '').trim().replace(/\s+/g, ' ');
    if (note.length < 5 || note.length > 300) return fail('note_required', 'Ghi rõ vi phạm (5–300 ký tự).');
    var all = objStore(KEY_UY_TIN), r = all[brokerId] || {};
    r.violations = (Array.isArray(r.violations) ? r.violations : []).concat([{ at: nowIso(), by: admin.id, type: type === 'bung-lich' ? 'bung-lich' : 'tin-rac', note: note }]);
    all[brokerId] = r;
    return writeJson(KEY_UY_TIN, all) ? { ok: true, uyTin: uyTin(brokerId) } : fail('storage', 'Trình duyệt đang chặn lưu dữ liệu.');
  }
  // Chủ trọ xác nhận khách do môi giới giới thiệu không đến buổi xem: đóng khách đó + 1 vi phạm bùng lịch cho môi giới.
  // Chỉ chủ của lịch, lịch đã chốt (confirmed), đã qua giờ hẹn và khách chưa được xác nhận đã xem. Mỗi lịch tính một lần.
  function markNoShow(bookingId, user) {
    if (!user || user.role !== 'landlord') return fail('forbidden', 'Chỉ chủ trọ mới xác nhận khách bùng lịch.');
    var b = B().all().filter(function (x) { return x.id === bookingId; })[0];
    if (!b || !norm(b.ref_code)) return fail('not_found', 'Không tìm thấy khách do môi giới giới thiệu.');
    var saved = store(), c = view(b, saved);
    if (b.landlord_id !== user.id) return fail('forbidden', 'Lịch này không thuộc phòng của bạn.');
    if (c.closed) return fail('closed', 'Khách này đã đóng (' + c.stage.label.toLowerCase() + ').');
    if (c.stageIndex !== 0) return fail('already', 'Khách đã xem phòng, không phải bùng lịch.');
    if (b.status !== 'confirmed') return fail('not_confirmed', 'Chỉ đánh dấu bùng lịch với lịch bạn đã xác nhận.');
    if (Date.parse(b.scheduled_at) > Date.now()) return fail('not_yet', 'Chưa tới giờ hẹn.');
    var rec = saved[b.id] || { stage: 'da-dat-lich', history: [] };
    rec.no_show = true;
    rec.history = (rec.history || []).concat([{ stage: 'bung-lich', by_id: user.id, by_role: 'landlord', at: nowIso() }]);
    saved[b.id] = rec;
    if (!writeJson(KEY_KHACH, saved)) return fail('storage', 'Trình duyệt đang chặn lưu dữ liệu (localStorage), chưa ghi được.');
    if (c.broker) {
      var all = objStore(KEY_UY_TIN), r = all[c.broker.id] || {};
      var vp = Array.isArray(r.violations) ? r.violations : [];
      if (!vp.some(function (v) { return v.booking_id === b.id; })) {
        r.violations = vp.concat([{ at: nowIso(), by: user.id, type: 'bung-lich', booking_id: b.id,
          note: 'Khách ' + c.name + ' không đến xem ' + (c.room ? c.room.code : b.room_id) + ' (chủ trọ xác nhận)' }]);
        all[c.broker.id] = r; writeJson(KEY_UY_TIN, all);
      }
    }
    return { ok: true, customer: view(b, saved) };
  }

  function clearViolations(brokerId, admin) {
    if (!admin || admin.role !== 'admin') return fail('forbidden', 'Chỉ quản trị An Cư mới gỡ vi phạm.');
    var all = objStore(KEY_UY_TIN);
    if (all[brokerId]) { all[brokerId].violations = []; writeJson(KEY_UY_TIN, all); }
    f1Check(brokerId);
    return { ok: true, uyTin: uyTin(brokerId) };
  }

  function reset() { try { [KEY_KHACH, KEY_DOI_SOAT, KEY_KHIEU_NAI, KEY_F1, KEY_UY_TIN].forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {} }

  /* ---------- Thông báo cho môi giới ----------
   * Máy chủ (npm start): GET /api/moi-gioi/thong-bao?ma= — sự kiện + khách có ref_code của mã đó (đã che tên).
   * Không có máy chủ: kho trình duyệt 'ancu-thong-bao-mg-v1' (components/ma-gioi-thieu.js). Gộp cả hai, mới nhất trước. */
  function feed(code) {
    var local = (global.AnCuRef ? global.AnCuRef.localEvents(code) : []).map(function (e) {
      return { id: e.id, kind: e.kind, title: e.title, body: e.body, createdAt: e.created_at, source: 'trinh-duyet' };
    });
    var done = function (srv) {
      var items = (srv ? srv.items.map(function (e) { e.source = 'may-chu'; return e; }) : []).concat(local)
        .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
      return { items: items, khach: srv ? srv.khach : [], server: !!srv };
    };
    if (!/^https?:$/.test(global.location.protocol) || !global.fetch) return Promise.resolve(done(null));
    return global.fetch('/api/moi-gioi/thong-bao?ma=' + encodeURIComponent(code), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return done(j && Array.isArray(j.items) ? j : null); }, function () { return done(null); });
  }

  // Khách máy chủ ghi nhận (lịch có ref_code) → cùng dạng với customersOfBroker, bỏ lịch đã có trong sổ khách
  // của trình duyệt (bookings.lich_id). Trạng thái lấy từ lịch + yêu cầu thuê trên máy chủ; chỉ để xem.
  function fromServer(khach, brokerId) {
    var have = {};
    B().all().forEach(function (b) { if (b.lich_id != null) have[String(b.lich_id)] = true; });
    var me = D().findUser(brokerId);
    return (khach || []).filter(function (k) { return !have[String(k.id)]; }).map(function (k) {
      var req = k.request, idx = 0;
      if (req && req.payStatus === 'paid') idx = 2;
      else if (k.status === 'completed' || (req && req.status === 'approved')) idx = 1;
      var closed = idx === 0 && (k.status === 'cancelled' || k.status === 'rejected');
      var room = D().findRoom(k.roomId) || { id: k.roomId, code: k.roomCode, title: k.room };
      return {
        booking: { id: 'srv-' + k.id, room_id: k.roomId, scheduled_at: k.date + 'T' + k.time + ':00+07:00', status: k.status,
          ref_code: me ? me.ref_code : null, created_at: k.createdAt },
        room: room, renter: null, name: k.tenant, phone: '', broker: me, landlord: null,
        stage: closed ? CLOSED : STAGES[idx], stageIndex: closed ? -1 : idx, closed: closed, history: [], last: null,
        server: true, request: req
      };
    });
  }

  // Chủ trọ đang mở trang quan-ly/*: tài khoản đăng nhập (components/nguoi-dung.js), chưa đăng nhập thì
  // chủ trọ demo theo ?chu= (AnCu.landlordId). Tài khoản chủ trọ mới không có phòng mẫu → mọi danh sách trống.
  function landlordNow() {
    var demo = function () { return global.AnCu && global.AnCu.landlordId ? global.AnCu.landlordId() : 'l-binh'; };
    var ND = global.AnCuNguoiDung;
    if (!ND) return Promise.resolve(demo());
    return ND.hienTai().then(function (u) { return u && u.role === 'landlord' ? u.id : demo(); }, demo);
  }

  global.AnCuMoiGioi = {
    KEY_KHACH: KEY_KHACH,
    KEY_DOI_SOAT: KEY_DOI_SOAT,
    STAGES: STAGES,
    CLOSED: CLOSED,
    stageOf: function (key) { return STAGES[stageIndex(key)] || null; },
    customersOfBroker: customersOfBroker,
    customersOfLandlord: customersOfLandlord,
    nextSteps: nextSteps,
    viewBlocker: viewBlocker,
    advance: advance,
    contractsOfBroker: contractsOfBroker,
    periodsForBroker: periodsForBroker,
    requestReconcile: requestReconcile,
    rejectReconcile: rejectReconcile,
    requestsOfBroker: requestsOfBroker,
    requestsOfLandlord: requestsOfLandlord,
    allRequests: function () { return requestsRaw().map(requestView).sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); }); },
    openRequestFor: openRequestFor,
    landlordNow: landlordNow,
    feed: feed,
    fromServer: fromServer,
    KEY_KHIEU_NAI: KEY_KHIEU_NAI,
    fileDispute: fileDispute,
    decideDispute: decideDispute,
    disputesOfBroker: disputesOfBroker,
    allDisputes: allDisputes,
    openDisputeFor: openDisputeFor,
    KEY_F1: KEY_F1, KEY_UY_TIN: KEY_UY_TIN, F1_HOP_DONG: F1_HOP_DONG, F1_DOANH_SO: F1_DOANH_SO, F1_DIEM: F1_DIEM,
    f1Status: f1Status, f1Check: f1Check, f1MarkCelebrated: f1MarkCelebrated, isUnlocked: isUnlocked, canRecruit: canRecruit,
    uyTin: uyTin, recordViolation: recordViolation, clearViolations: clearViolations, markNoShow: markNoShow, NO_SHOW: NO_SHOW,
    reset: reset
  };
})(window);
