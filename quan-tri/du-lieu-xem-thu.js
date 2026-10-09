// Dữ liệu mẫu cho CHẾ ĐỘ XEM THỬ của khu quản trị.
//
// Mở trang bằng file:// hoặc xem bản tĩnh trên Vercel thì không có /api/*, hai trang
// quan-tri/trang-chu.html và quan-tri/tong-quan.html cùng chạy trên bộ dữ liệu này nên
// số liệu hai trang luôn khớp nhau. Dữ liệu lưu trong localStorage của chính trình duyệt
// đang xem, không chia sẻ cho người khác.
//
// Dùng: XemThu.tai() lấy dữ liệu, XemThu.api(method, path, body) thay cho fetch,
//       XemThu.toi() trả về tài khoản quản trị mẫu.
window.XemThu = (function(){
  'use strict';

  // Bỏ dấu để tìm kiếm không phân biệt dấu (giống fold ở server/quan-tri.mjs)
  function khongDau(v){
    return String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }

  var demo = null;

  var DEMO_KEY = 'an-cu-quan-tri-demo';
  var PLAN_PRICE = { plus: 199000, pro: 499000 };
  var PLAN_LIMIT = { plus: { rooms: 15, accounts: 1 }, pro: { rooms: 60, accounts: 5 } };
  var PLAN_LABEL = { plus: 'Plus', pro: 'Pro' };
  var TRIAL_DAYS = 15;

  var d2 = function(n){ return (n < 10 ? '0' : '') + n; };
  function dYmd(d){ return d.getUTCFullYear() + '-' + d2(d.getUTCMonth() + 1) + '-' + d2(d.getUTCDate()); }
  function homNay(){ var n = new Date(); return n.getFullYear() + '-' + d2(n.getMonth() + 1) + '-' + d2(n.getDate()); }
  function congNgay(s, n){ return dYmd(new Date(new Date(s + 'T00:00:00Z').getTime() + n * 86400000)); }
  // Cộng tháng, giữ ngày trong tháng; tháng ngắn hơn thì lùi về ngày cuối tháng
  function congThang(s, n){
    var p = s.split('-').map(Number);
    var cuoi = new Date(Date.UTC(p[0], p[1] - 1 + n + 1, 0)).getUTCDate();
    return new Date(Date.UTC(p[0], p[1] - 1 + n, Math.min(p[2], cuoi))).toISOString().slice(0, 10);
  }

  function demoSeed(){
    var t = homNay();
    var batDau = congNgay(t, -40);
    var s = {
      nextSub: 2, nextInv: 4,
      users: [
        { id:'ad-01',   role:'admin',    name:'Quản trị An Cư',  phone:'0900000001', email:'admin@ancu.test',  status:'active', createdAt:congNgay(t,-60), bookings:null },
        { id:'l-binh',  role:'landlord', name:'Trần Hoà',        phone:'0988000999', email:'chutro@ancu.test', status:'active', createdAt:congNgay(t,-55), bookings:null },
        { id:'l-mai',   role:'landlord', name:'Lê Thu Mai',      phone:'0977111222', email:'mai@ancu.test',    status:'active', createdAt:congNgay(t,-20), bookings:null },
        { id:'u-trang', role:'renter',   name:'Phạm Thu Trang',  phone:'0901234567', email:'trang@ancu.test',  status:'active', createdAt:congNgay(t,-50), bookings:3 },
        { id:'u-an',    role:'renter',   name:'Nguyễn Văn An',   phone:'0912000111', email:'an@ancu.test',     status:'active', createdAt:congNgay(t,-30), bookings:1 },
        { id:'u-linh',  role:'renter',   name:'Trần Mỹ Linh',    phone:'0987000222', email:'linh@ancu.test',   status:'locked', createdAt:congNgay(t,-12), bookings:0 },
        { id:'u-huy',   role:'renter',   name:'Lê Quang Huy',    phone:'0933000333', email:'huy@ancu.test',    status:'active', createdAt:congNgay(t,-5),  bookings:2 }
      ],
      props: demoNhaTro(t),
      posts: demoTinDang(t),
      nextPost: 7,
      subs: [{ id:1, landlordId:'l-binh', plan:'plus', price:PLAN_PRICE.plus, months:3, status:'active',
               startedAt:batDau, trialEndsAt:congNgay(batDau, TRIAL_DAYS), cancelledAt:null }],
      invoices: []
    };
    var ky1 = congNgay(batDau, TRIAL_DAYS);
    for (var i = 0; i < 3; i++) {
      var han = congThang(ky1, i);
      s.invoices.push({
        id: i + 1, subscriptionId: 1, period: han.slice(0, 7), amount: PLAN_PRICE.plus, dueDate: han,
        status: i === 0 ? 'paid' : 'pending', paidAt: i === 0 ? han : null, method: i === 0 ? 'chuyen-khoan' : null
      });
    }
    return s;
  }
  // Nhà trọ mẫu cho chế độ xem thử (bản thật đọc NHA_TRO trong server/phong.mjs).
  // ng(id, kind, ngay): id trỏ tới tài khoản trong demo.users; id null = khách chưa có tài khoản.
  function demoNhaTro(t){
    var ng = function(id, name, phone, kind, at){ return { id:id, name:name, phone:phone, kind:kind, at:at }; };
    var P = function(id, code, title, price, address, people){
      return { id:id, code:code, title:title, price:price, address:address, people:people };
    };
    return [
      { id:'nt-an-binh', name:'Nhà trọ An Bình', address:'Cầu Giấy, Hà Nội', landlordId:'l-binh', rooms:[
        P('P.101', 'P.101', 'Phòng P.101', 3500000, 'Nhà trọ An Bình, Cầu Giấy, Hà Nội',
          [ng('u-an', 'Nguyễn Văn An', '0912000111', 'tenant', congNgay(t, -60))]),
        P('P.102', 'P.102', 'Phòng P.102', 3200000, 'Nhà trọ An Bình, Cầu Giấy, Hà Nội',
          [ng(null, 'Trần Minh Anh', '0987654321', 'viewing', congNgay(t, 2))]),
        P('P.201', 'P.201', 'Phòng P.201', 4100000, 'Nhà trọ An Bình, Cầu Giấy, Hà Nội',
          [ng('u-linh', 'Trần Mỹ Linh', '0987000222', 'tenant', congNgay(t, -45))]),
        P('P.301', 'P.301', 'Phòng P.301', 3500000, 'Nhà trọ An Bình, Cầu Giấy, Hà Nội',
          [ng('u-trang', 'Phạm Thu Trang', '0901234567', 'tenant', congNgay(t, -35))]),
        P('P.302', 'P.302', 'Phòng P.302', 3000000, 'Nhà trọ An Bình, Cầu Giấy, Hà Nội',
          [ng('u-huy', 'Lê Quang Huy', '0933000333', 'tenant', congNgay(t, -20))]),
        P('P.202', 'P.202', 'Phòng P.202', 3800000, 'Nhà trọ An Bình, Cầu Giấy, Hà Nội', [])
      ] },
      { id:'nt-khuong-dinh', name:'Nhà trọ Khương Đình', address:'12 Khương Đình, P. Khương Đình, Thanh Xuân, Hà Nội', landlordId:'l-mai', rooms:[
        P('p04', 'P04', 'Studio hiện đại gần trung tâm', 3900000, '12 Khương Đình, P. Khương Đình, Thanh Xuân, Hà Nội',
          [ng('u-an', 'Nguyễn Văn An', '0912000111', 'pending', congNgay(t, 5))])
      ] },
      { id:'nt-vinh-hung', name:'Nhà trọ Vĩnh Hưng', address:'203 Vĩnh Hưng, P. Vĩnh Hưng, Hoàng Mai, Hà Nội', landlordId:'l-mai', rooms:[
        P('p06', 'P06', 'Phòng rộng, phù hợp gia đình', 4600000, '203 Vĩnh Hưng, P. Vĩnh Hưng, Hoàng Mai, Hà Nội',
          [ng('u-linh', 'Trần Mỹ Linh', '0987000222', 'viewing', congNgay(t, 3))]),
        P('p09', 'P09', 'Căn hộ dịch vụ 2 phòng ngủ', 6500000, '15 Việt Hưng, P. Việt Hưng, Long Biên, Hà Nội',
          [ng('u-trang', 'Phạm Thu Trang', '0901234567', 'viewing', congNgay(t, 4))])
      ] }
    ];
  }

  // Tin đăng mẫu: vài tin đã duyệt, vài tin chờ duyệt, trong đó có một tin đủ dấu hiệu lừa đảo
  function demoTinDang(t){
    return [
      { id:1, roomId:'p02', landlordId:'l-mai', title:'Căn hộ mini full nội thất',
        address:'27 Đào Duy Anh, Phường Kim Liên, Hà Nội', price:4200000, area:30, phone:'0977111222',
        description:'Căn hộ mini khép kín trong toà có thang máy, đầy đủ nội thất, có chỗ để xe.',
        status:'approved', reason:'', createdAt:congNgay(t,-38), decidedAt:congNgay(t,-37), decidedBy:'ad-01' },
      { id:2, roomId:'p06', landlordId:'l-mai', title:'Phòng rộng, phù hợp gia đình',
        address:'203 Vĩnh Hưng, Phường Vĩnh Hưng, Hà Nội', price:4600000, area:35, phone:'0977111222',
        description:'Phòng rộng cho gia đình nhỏ, có chỗ phơi đồ riêng.',
        status:'approved', reason:'', createdAt:congNgay(t,-30), decidedAt:congNgay(t,-29), decidedBy:'ad-01' },
      { id:3, roomId:null, landlordId:'l-mai', title:'Phòng mới sửa, gần ĐH Thương Mại',
        address:'45 Hồ Tùng Mậu, Phường Cầu Giấy, Hà Nội', price:2900000, area:20, phone:'0977111222',
        description:'Phòng mới sơn sửa, có điều hoà và nóng lạnh. Hẹn xem phòng trong ngày.',
        status:'pending', reason:'', createdAt:congNgay(t,-4), decidedAt:null, decidedBy:null },
      { id:4, roomId:null, landlordId:'l-binh', title:'CHO THUÊ CĂN HỘ FULL NỘI THẤT GIÁ SỐC',
        address:'Quận Cầu Giấy, Hà Nội', price:900000, area:35, phone:'0589123456',
        description:'Căn hộ 35m2 full nội thất chỉ 900k/tháng. Chốt cọc 2 triệu qua Zalo trong hôm nay, '
          + 'không cần xem phòng, ai chuyển khoản trước thì được. Liên hệ gấp kẻo hết.',
        status:'pending', reason:'', createdAt:congNgay(t,-2), decidedAt:null, decidedBy:null },
      { id:5, roomId:null, landlordId:'l-mai', title:'Phòng khép kín Long Biên, có thang máy',
        address:'15 Việt Hưng, Phường Việt Hưng, Hà Nội', price:3200000, area:24, phone:'0977111222',
        description:'Phòng khép kín trong toà nhà có thang máy, gần chợ Việt Hưng.',
        status:'pending', reason:'', createdAt:congNgay(t,-1), decidedAt:null, decidedBy:null },
      { id:6, roomId:null, landlordId:'l-binh', title:'Nhà nguyên căn 10 phòng, cho thuê 500k/phòng',
        address:'Không ghi rõ địa chỉ', price:500000, area:null, phone:'0325000111',
        description:'Cho thuê giá rẻ, đặt cọc giữ chỗ trước mới dẫn đi xem.',
        status:'rejected', reason:'Giá không có thật và yêu cầu đặt cọc trước khi xem phòng — dấu hiệu lừa đảo.',
        createdAt:congNgay(t,-11), decidedAt:congNgay(t,-10), decidedBy:'ad-01' }
    ];
  }

  // Dấu hiệu đáng ngờ, chấm giống dauHieu() ở server/quan-tri.mjs
  var TU_KHOA_RUI_RO = [
    ['chuyển khoản trước', 'Giục chuyển khoản trước'],
    ['cọc giữ chỗ', 'Đòi cọc giữ chỗ'],
    ['chốt cọc', 'Giục chốt cọc'],
    ['cọc trước', 'Đòi cọc trước khi xem phòng'],
    ['không cần xem phòng', 'Không cho xem phòng trước'],
    ['zalo', 'Đẩy giao dịch sang Zalo'],
    ['giá sốc', 'Lời rao giật tít'],
    ['gấp kẻo hết', 'Tạo sức ép thời gian'],
    ['trong hôm nay', 'Tạo sức ép thời gian']
  ];
  function demoDauHieu(t, chu){
    var co = [];
    var mo = (t.title + ' ' + t.description).toLowerCase();
    TU_KHOA_RUI_RO.forEach(function(x){ if (mo.indexOf(x[0]) !== -1 && co.indexOf(x[1]) === -1) co.push(x[1]); });
    if (t.price > 0 && t.price < 1500000) co.push('Giá thấp bất thường');
    if (chu && t.phone && t.phone.replace(/\D/g, '') !== String(chu.phone || '').replace(/\D/g, '')) co.push('Số trong tin khác số tài khoản');
    if (chu && chu.status === 'locked') co.push('Tài khoản người đăng đang bị khoá');
    if (!String(t.address || '').trim() || /không ghi/i.test(t.address)) co.push('Địa chỉ không rõ ràng');
    return co;
  }

  function demoTinDangList(params){
    var thuTu = { pending: 0, rejected: 1, approved: 2 };
    var key = khongDau(params.tim).trim();
    return demo.posts.map(function(t){
      var chu = demo.users.filter(function(u){ return u.id === t.landlordId; })[0];
      return {
        id:t.id, roomId:t.roomId, title:t.title, address:t.address, price:t.price, area:t.area,
        phone:t.phone, description:t.description, status:t.status, reason:t.reason,
        createdAt:t.createdAt, decidedAt:t.decidedAt, decidedBy:t.decidedBy,
        landlordId:t.landlordId,
        landlord: chu ? chu.name : 'Tài khoản đã xoá',
        landlordPhone: chu ? chu.phone : '',
        landlordStatus: chu ? chu.status : null,
        flags: demoDauHieu(t, chu)
      };
    }).filter(function(t){
      if (params.trangThai && t.status !== params.trangThai) return false;
      if (!key) return true;
      return [t.title, t.address, t.landlord, t.landlordPhone, t.phone, t.roomId].some(function(v){
        return khongDau(v).indexOf(key) !== -1;
      });
    }).sort(function(a, b){
      return (thuTu[a.status] - thuTu[b.status]) || (a.createdAt < b.createdAt ? 1 : -1);
    });
  }

  function demoLoad(){
    try {
      var raw = localStorage.getItem(DEMO_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        // Dữ liệu lưu từ bản trước có thể chưa có mục nhà trọ: bù vào từ dữ liệu mẫu
        if (o && o.users && o.subs) {
          if (!o.props) o.props = demoNhaTro(homNay());
          if (!o.posts) { o.posts = demoTinDang(homNay()); o.nextPost = 7; }
          return o;
        }
      }
    } catch (e) { /* trình duyệt chặn localStorage: dùng bộ nhớ tạm */ }
    return demoSeed();
  }
  function demoSave(){ try { localStorage.setItem(DEMO_KEY, JSON.stringify(demo)); } catch (e) {} }

  function demoLoi(msg){ var e = new Error(msg); e.demo = true; return e; }
  function demoQuet(){   // kỳ chưa thu mà quá hạn -> quá hạn
    var t = homNay();
    demo.invoices.forEach(function(i){ if (i.status === 'pending' && i.dueDate < t) i.status = 'overdue'; });
  }
  function demoNguoiDung(id){
    var u = demo.users.filter(function(x){ return x.id === id; })[0];
    if (!u) throw demoLoi('Không tìm thấy tài khoản này.');
    return u;
  }
  function demoGoiList(){
    demoQuet();
    return demo.subs.map(function(s){
      var u = demoNguoiDung(s.landlordId);
      var mine = demo.invoices.filter(function(i){ return i.subscriptionId === s.id; })
        .sort(function(a, b){ return a.dueDate < b.dueDate ? -1 : 1; });
      var chuaThu = mine.filter(function(i){ return i.status !== 'paid'; });
      return {
        id: s.id, landlordId: s.landlordId, landlord: u.name, phone: u.phone, email: u.email,
        plan: s.plan, planName: PLAN_LABEL[s.plan], price: s.price, months: s.months, status: s.status,
        rooms: PLAN_LIMIT[s.plan].rooms, accounts: PLAN_LIMIT[s.plan].accounts,
        startedAt: s.startedAt, trialEndsAt: s.trialEndsAt, cancelledAt: s.cancelledAt,
        paid: mine.filter(function(i){ return i.status === 'paid'; }).reduce(function(n, i){ return n + i.amount; }, 0),
        due: chuaThu.reduce(function(n, i){ return n + i.amount; }, 0),
        overdue: mine.filter(function(i){ return i.status === 'overdue'; }).length,
        nextDue: chuaThu.length ? chuaThu[0].dueDate : null,
        invoices: mine
      };
    }).sort(function(a, b){ return b.id - a.id; });
  }
  function demoTaiKhoanList(params){
    demoQuet();
    var goi = demoGoiList();
    var key = (params.tim || '').trim().toLowerCase();
    return demo.users.filter(function(u){
      if (params.vaiTro && u.role !== params.vaiTro) return false;
      if (params.trangThai && u.status !== params.trangThai) return false;
      if (!key) return true;
      return [u.name, u.phone, u.email, u.id].some(function(v){ return String(v || '').toLowerCase().indexOf(key) !== -1; });
    }).map(function(u){
      var s = goi.filter(function(g){ return g.landlordId === u.id; })[0];
      return {
        id: u.id, role: u.role, name: u.name, phone: u.phone, email: u.email, status: u.status,
        createdAt: u.createdAt, bookings: u.role === 'renter' ? u.bookings : null,
        plan: u.role === 'landlord' && s ? { id: s.id, plan: s.plan, status: s.status } : null
      };
    });
  }

  function demoNhaTroList(tim){
    var key = khongDau(tim).trim();
    var goi = demoGoiList();
    var dem = function(nt, kind){
      return nt.reduce(function(n, x){
        return n + x.rooms.reduce(function(k, r){
          return k + r.people.filter(function(ng){ return ng.kind === kind; }).length;
        }, 0);
      }, 0);
    };
    var khopPhong = function(r){
      if ([r.code, r.title, r.address].some(function(v){ return khongDau(v).indexOf(key) !== -1; })) return true;
      return r.people.some(function(ng){ return khongDau(ng.name).indexOf(key) !== -1 || khongDau(ng.phone).indexOf(key) !== -1; });
    };
    var items = demo.users.filter(function(u){ return u.role === 'landlord'; }).map(function(u){
      var s = goi.filter(function(g){ return g.landlordId === u.id; })[0];
      var props = demo.props.filter(function(nt){ return nt.landlordId === u.id; }).map(function(nt){
        return { id:nt.id, name:nt.name, address:nt.address, rooms:nt.rooms.map(function(r){
          var people = r.people.map(function(ng){
            var acc = ng.id ? demo.users.filter(function(x){ return x.id === ng.id; })[0] : null;
            return {
              id: acc ? acc.id : null, name: acc ? acc.name : ng.name, phone: acc ? acc.phone : ng.phone,
              userStatus: acc ? acc.status : null, kind: ng.kind,
              since: ng.kind === 'tenant' ? ng.at : null, at: ng.at
            };
          });
          var sl = function(kind){ return people.filter(function(x){ return x.kind === kind; }).length; };
          return { id:r.id, code:r.code, title:r.title, address:r.address, price:r.price, people:people,
                   tenants:sl('tenant'), pending:sl('pending'), viewings:sl('viewing') };
        }) };
      });
      return {
        landlordId:u.id, landlord:u.name, phone:u.phone, email:u.email, status:u.status, createdAt:u.createdAt,
        plan: s ? { id:s.id, plan:s.plan, planName:PLAN_LABEL[s.plan], status:s.status } : null,
        properties: props,
        rooms: props.reduce(function(n, nt){ return n + nt.rooms.length; }, 0),
        tenants: dem(props, 'tenant'), pending: dem(props, 'pending'), viewings: dem(props, 'viewing')
      };
    });

    // Tìm chủ trọ thì giữ nguyên nhà trọ của người đó; tìm nhà trọ / phòng / người thuê thì
    // chỉ giữ lại phần khớp từ khoá (giống listProperties ở server/quan-tri.mjs).
    if (key) {
      items = items.filter(function(it){
        if ([it.landlord, it.phone, it.email, it.landlordId].some(function(v){ return khongDau(v).indexOf(key) !== -1; })) return true;
        it.properties = it.properties.map(function(nt){
          if (khongDau(nt.name).indexOf(key) !== -1 || khongDau(nt.address).indexOf(key) !== -1) return nt;
          return { id:nt.id, name:nt.name, address:nt.address, rooms:nt.rooms.filter(khopPhong) };
        }).filter(function(nt){ return nt.rooms.length > 0; });
        if (!it.properties.length) return false;
        it.rooms = it.properties.reduce(function(n, nt){ return n + nt.rooms.length; }, 0);
        it.tenants = dem(it.properties, 'tenant');
        it.pending = dem(it.properties, 'pending');
        it.viewings = dem(it.properties, 'viewing');
        return true;
      });
    }
    return { items: items, chuaGan: [] };
  }

  function demoApi(method, path, body){
    var duong = path.split('?')[0];
    var params = {};
    (path.split('?')[1] || '').split('&').filter(Boolean).forEach(function(kv){
      var p = kv.split('='); params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });

    if (duong === '/api/toi') return { user: demoMe() };
    if (duong === '/api/dang-xuat') return { ok: true };

    if (duong === '/api/quan-tri/tai-khoan' && method === 'GET') return { items: demoTaiKhoanList(params) };
    if (duong.indexOf('/api/quan-tri/tai-khoan/') === 0 && method === 'PATCH') {
      var u = demoNguoiDung(decodeURIComponent(duong.slice('/api/quan-tri/tai-khoan/'.length)));
      if (u.role === 'admin') throw demoLoi('Không khoá được tài khoản quản trị.');
      u.status = body.action === 'lock' ? 'locked' : 'active';
      demoSave();
      return { item: demoTaiKhoanList({}).filter(function(x){ return x.id === u.id; })[0] };
    }

    if (duong === '/api/quan-tri/tin-dang' && method === 'GET') return { items: demoTinDangList(params) };
    if (duong.indexOf('/api/quan-tri/tin-dang/') === 0 && method === 'PATCH') {
      var tid = Number(duong.slice('/api/quan-tri/tin-dang/'.length));
      var tin = demo.posts.filter(function(x){ return x.id === tid; })[0];
      if (!tin) throw demoLoi('Không tìm thấy tin đăng này.');
      var doi = { duyet:'approved', 'tu-choi':'rejected', 'cho-duyet-lai':'pending' }[body.action];
      if (!doi) throw demoLoi('Thao tác không hợp lệ.');
      if (doi === tin.status) throw demoLoi('Tin đăng này đã ở trạng thái đó rồi.');
      if (doi === 'rejected' && !String(body.reason || '').trim()) throw demoLoi('Hãy ghi lý do từ chối để chủ trọ biết đường sửa.');
      tin.status = doi;
      tin.reason = doi === 'rejected' ? String(body.reason).trim() : '';
      tin.decidedAt = doi === 'pending' ? null : homNay();
      tin.decidedBy = doi === 'pending' ? null : 'ad-01';
      demoSave();
      return { item: demoTinDangList({}).filter(function(x){ return x.id === tid; })[0] };
    }

    if (duong === '/api/quan-tri/nha-tro' && method === 'GET') return demoNhaTroList(params.tim);

    if (duong === '/api/quan-tri/goi' && method === 'GET') return { items: demoGoiList() };
    if (duong === '/api/quan-tri/goi' && method === 'POST') {
      var chuTro = demoNguoiDung(body.landlordId);
      if (chuTro.role !== 'landlord') throw demoLoi('Chỉ chủ trọ mới đăng ký được gói dịch vụ.');
      if (!PLAN_PRICE[body.plan]) throw demoLoi('Gói không hợp lệ (chỉ có Plus hoặc Pro).');
      if (demo.subs.some(function(s){ return s.landlordId === chuTro.id && s.status !== 'cancelled'; })) {
        throw demoLoi('Chủ trọ này đang có gói còn hiệu lực. Hãy huỷ gói cũ trước.');
      }
      var soKy = Number(body.months || 12);
      var batDau = homNay();
      var coThu = body.trial !== false;
      var sub = {
        id: demo.nextSub++, landlordId: chuTro.id, plan: body.plan, price: PLAN_PRICE[body.plan], months: soKy,
        status: coThu ? 'trial' : 'active', startedAt: batDau,
        trialEndsAt: coThu ? congNgay(batDau, TRIAL_DAYS) : null, cancelledAt: null
      };
      demo.subs.push(sub);
      var dau = coThu ? sub.trialEndsAt : batDau;
      for (var k = 0; k < soKy; k++) {
        var han2 = congThang(dau, k);
        demo.invoices.push({ id: demo.nextInv++, subscriptionId: sub.id, period: han2.slice(0, 7),
          amount: sub.price, dueDate: han2, status: 'pending', paidAt: null, method: null });
      }
      demoSave();
      return { item: demoGoiList().filter(function(s){ return s.id === sub.id; })[0] };
    }
    if (duong.indexOf('/api/quan-tri/goi/') === 0 && method === 'PATCH') {
      var sid = Number(duong.slice('/api/quan-tri/goi/'.length));
      var s2 = demo.subs.filter(function(x){ return x.id === sid; })[0];
      if (!s2) throw demoLoi('Không tìm thấy gói này.');
      if (s2.status === 'cancelled') throw demoLoi('Gói này đã huỷ rồi.');
      s2.status = 'cancelled';
      s2.cancelledAt = homNay();
      demo.invoices = demo.invoices.filter(function(i){
        return !(i.subscriptionId === sid && i.status === 'pending' && i.dueDate > homNay());
      });
      demoSave();
      return { item: demoGoiList().filter(function(x){ return x.id === sid; })[0] };
    }
    if (duong.indexOf('/api/quan-tri/hoa-don/') === 0 && method === 'PATCH') {
      var iid = Number(duong.slice('/api/quan-tri/hoa-don/'.length));
      var inv = demo.invoices.filter(function(x){ return x.id === iid; })[0];
      if (!inv) throw demoLoi('Không tìm thấy kỳ thanh toán này.');
      if (body.paid === false) { inv.status = 'pending'; inv.paidAt = null; inv.method = null; }
      else {
        if (inv.status === 'paid') throw demoLoi('Kỳ này đã ghi nhận thanh toán rồi.');
        inv.status = 'paid'; inv.paidAt = homNay(); inv.method = body.method || 'chuyen-khoan';
      }
      demoSave();
      return { item: inv };
    }

    if (duong === '/api/quan-tri/tong-quan' && method === 'GET') {
      var us = demoTaiKhoanList({});
      var gs = demoGoiList();
      var nt = demoNhaTroList('').items;
      var dangChay = gs.filter(function(g){ return g.status !== 'cancelled'; });
      var t = homNay();
      var bay = congNgay(t, 7);
      var daThu = function(ky){
        return demo.invoices.filter(function(i){ return i.status === 'paid' && String(i.paidAt || '').slice(0, 7) === ky; })
          .reduce(function(n, i){ return n + i.amount; }, 0);
      };
      var p = t.split('-');
      var truoc = p[1] === '01' ? (Number(p[0]) - 1) + '-12' : p[0] + '-' + (Number(p[1]) - 1 < 10 ? '0' : '') + (Number(p[1]) - 1);
      var sapHetHan = dangChay.filter(function(g){ return g.nextDue && g.nextDue >= t && g.nextDue <= bay; });
      return { summary: {
        today: t,
        revenue: { month: daThu(t.slice(0, 7)), prevMonth: daThu(truoc), total: gs.reduce(function(n, g){ return n + g.paid; }, 0) },
        // Chưa làm: hệ thống ticket hỗ trợ
        support: { openTickets: null },
        listings: { pending: demo.posts.filter(function(x){ return x.status === 'pending'; }).length },
        properties: {
          total: nt.reduce(function(n, x){ return n + x.properties.length; }, 0),
          rooms: nt.reduce(function(n, x){ return n + x.rooms; }, 0),
          tenants: nt.reduce(function(n, x){ return n + x.tenants; }, 0)
        },
        users: {
          total: us.length,
          renters: us.filter(function(u){ return u.role === 'renter'; }).length,
          landlords: us.filter(function(u){ return u.role === 'landlord'; }).length,
          locked: us.filter(function(u){ return u.status === 'locked'; }).length
        },
        plans: {
          active: dangChay.length,
          plus: dangChay.filter(function(g){ return g.plan === 'plus'; }).length,
          pro: dangChay.filter(function(g){ return g.plan === 'pro'; }).length,
          trial: dangChay.filter(function(g){ return g.status === 'trial'; }).length,
          overdue: dangChay.filter(function(g){ return g.overdue > 0; }).length,
          expiring: sapHetHan.length,
          revenue: gs.reduce(function(n, g){ return n + g.paid; }, 0),
          due: dangChay.reduce(function(n, g){ return n + g.due; }, 0)
        }
      } };
    }
    throw demoLoi('Chế độ xem thử chưa hỗ trợ thao tác này.');
  }
  function demoMe(){ return { id: 'ad-01', role: 'admin', name: 'Quản trị An Cư', phone: '0900000001', email: 'admin@ancu.test', status: 'active' }; }

  return {
    KEY: DEMO_KEY,
    PLAN_PRICE: PLAN_PRICE,
    PLAN_LABEL: PLAN_LABEL,
    PLAN_LIMIT: PLAN_LIMIT,
    TRIAL_DAYS: TRIAL_DAYS,
    tai: function(){ if (!demo) demo = demoLoad(); return demo; },
    api: function(method, path, body){ if (!demo) demo = demoLoad(); return demoApi(method, path, body); },
    toi: demoMe
  };
})();
