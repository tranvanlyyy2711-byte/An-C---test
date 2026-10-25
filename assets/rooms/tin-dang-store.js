/* Shared catalog. Demo data never replaces a connected server's data. */
(function () {
  'use strict';
  const seeds = window.ANCU_LISTING_PREVIEW || [];
  const KEY = 'ancu-listings-demo-v4';
  let state, mode, readyPromise;
  const clone = x => JSON.parse(JSON.stringify(x));
  const fresh = () => ({version:4, ownerId:seeds[0]?.id, changes:{}});
  const listeners = new Set();
  function restore(raw) {
    if (!raw || raw.version !== 4 || !raw.changes || typeof raw.changes !== 'object') return fresh();
    const clean = fresh();
    if (seeds.some(x => x.id === raw.ownerId)) clean.ownerId = raw.ownerId;
    for (const seed of seeds) {
      const value = raw.changes[seed.id];
      if (!value) continue;
      try { validate(value); clean.changes[seed.id] = {...clone(seed), ...pick(value), id:seed.id, visible:value.visible !== false, status:'approved'}; } catch {}
    }
    return clean;
  }
  function readState() {
    try { state = restore(JSON.parse(localStorage.getItem(KEY))); } catch { state = fresh(); }
    if (location.protocol === 'file:' && location.hash.startsWith('#ancu-demo=')) {
      try {
        const bytes = Uint8Array.from(atob(location.hash.slice(11)), c => c.charCodeAt(0));
        state = restore(JSON.parse(new TextDecoder().decode(bytes)));
        localStorage.setItem(KEY, JSON.stringify(state));
        history.replaceState(null, '', location.pathname + location.search);
      } catch {}
    }
  }
  function emit() { for (const fn of listeners) fn(); }
  function persist() {
    let saved = true;
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { saved = false; }
    emit(); if(window.AnCu) window.AnCu.invalidate('tin-dang'); return saved;
  }
  async function request(url, method = 'GET', body, timeout = 8000) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    try {
      const headers=body ? {'Content-Type':'application/json'} : {};
      if(mode==='cloud' && window.AnCuAuth){const token=await window.AnCuAuth.token();if(token)headers.Authorization='Bearer '+token;}
      const response = await fetch(url, {method, credentials:'same-origin', cache:'no-store', signal:abort.signal,
        headers, body:body ? JSON.stringify(body) : undefined});
      let data; try { data = await response.json(); } catch { throw Object.assign(Error('Địa chỉ này chưa chạy API An Cư.'), {status:response.status || 404}); }
      if (!response.ok) throw Object.assign(Error(data.message || data.error?.message || 'Không thực hiện được thao tác.'), {status:response.status});
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw Error('Máy chủ phản hồi quá lâu. Bấm Thử lại hoặc kiểm tra cửa sổ chạy web.');
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function ready() {
    if (!readyPromise) readyPromise = (async () => {
      if (location.protocol === 'file:') mode = 'demo';
      else if(window.AnCuAuth?.dungDuoc() || !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname)) {
        mode='cloud'; // Vercel: never switch to localStorage if API is missing or unavailable.
      } else {
        const health=await request('/api/suc-khoe','GET',undefined,2500);
        if(health.ok!==true)throw Error('Chưa kết nối được máy chủ. Chạy npm start rồi tải lại trang.');
        mode='server';
      }
      if (mode === 'demo') readState();
      return mode;
    })().catch(error => { readyPromise = null; throw error; });
    return readyPromise;
  }
  const keys = ['title','price','area','maxPeople','phone','address','ward','district','description','amenities','images','latitude','longitude'];
  function pick(value) { return Object.fromEntries(keys.filter(k => Object.hasOwn(value,k)).map(k => [k,value[k]])); }
  function validate(r) {
    for (const [key, max] of [['title',200],['address',400],['description',10000],['phone',20]])
      if (typeof r[key] !== 'string' || !r[key].trim() || r[key].length > max) throw Error('Điền đủ tiêu đề, địa chỉ, mô tả và số điện thoại.');
    if (!/^0\d{9}$/.test(r.phone)) throw Error('Số điện thoại cần 10 chữ số và bắt đầu bằng 0.');
    if (!Number.isSafeInteger(r.price) || r.price <= 0 || r.price > 1000000000 || !Number.isFinite(r.area) || r.area <= 0 || r.area > 10000 || !Number.isInteger(r.maxPeople) || r.maxPeople < 1 || r.maxPeople > 100) throw Error('Kiểm tra giá thuê, diện tích và số người tối đa.');
    const good = (n,max) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;
    if ((r.latitude === null) !== (r.longitude === null) || (r.latitude !== null && (!good(r.latitude,90) || !good(r.longitude,180)))) throw Error('Nhập đủ hai tọa độ hợp lệ hoặc để trống cả hai.');
    if (!Array.isArray(r.images) || r.images.length < 1 || r.images.length > 12 || r.images.some(x => typeof x!=='string' || x.length>2000 || !(/^\/assets\/rooms\/[\w.-]+\.(webp|jpe?g|png)$/i.test(x) || /^https:\/\/[^\s<>"']+$/i.test(x)))) throw Error('Cần 1–12 ảnh trong /assets/rooms/ hoặc đường dẫn HTTPS.');
    if (!Array.isArray(r.amenities) || r.amenities.length > 30 || r.amenities.some(x => typeof x !== 'string' || x.length > 80)) throw Error('Kiểm tra danh sách tiện ích.');
  }
  function rooms() { return seeds.map(seed => ({...clone(seed), status:'approved', visible:true, ...clone(state.changes[seed.id] || {})})); }
  function publicItem(r) {
    return {...clone(r), people:r.maxPeople, desc:r.description, postedAt:r.postedAt.split('-').reverse().join('/'),
      city:'ha-noi', type:'Phòng trọ', image:r.images[0], alt:r.title, posted:0, floor:null, distance:null};
  }
  const service = {
    ready, request, validate,
    get mode() { return mode; },
    async publicRooms() {
      await ready();
      if (mode !== 'demo') return (await request('/api/tin-dang')).items;
      return rooms().filter(r => r.visible).map(publicItem);
    },
    async owner() {
      await ready();
      if (mode !== 'demo') {
        const user = mode==='cloud' ? await window.AnCuAuth?.toi() : (await request('/api/toi')).user;
        if (user?.role !== 'landlord') return {user, room:null};
        return {user, room:(await request('/api/chu-tro/tin-dang')).item};
      }
      const room = rooms().find(r => r.id === state.ownerId) || rooms()[0];
      return {user:{id:'demo-'+room.id, role:'landlord', name:'Chủ trọ mẫu '+room.phone, phone:room.phone}, room};
    },
    async save(body, create = false) {
      await ready();
      if (mode !== 'demo') { const item = (await request('/api/chu-tro/tin-dang', create ? 'POST' : 'PATCH', body)).item; if(window.AnCu) window.AnCu.invalidate('tin-dang'); return item; }
      if (create) throw Error('Bản chạy thử có sẵn một phòng cho mỗi tài khoản mẫu.');
      const old = rooms().find(r => r.id === state.ownerId);
      const result = {...old, ...pick(body), visible:body.visible ?? old.visible};
      validate(result); state.changes[old.id] = result; persist(); return result;
    },
    async login(phone,password) { await ready(); if(mode==='cloud'){if(!window.AnCuAuth?.dungDuoc())throw Error('Chưa cấu hình Supabase Auth.');const result=await window.AnCuAuth.dangNhap({dinhDanh:phone,matKhau:password});if(result.error)throw Error(result.message || 'Đăng nhập không thành công.');return result;}return request('/api/dang-nhap','POST',{phone,password}); },
    async logout() { await ready();if(mode==='cloud')return window.AnCuAuth.dangXuat();return request('/api/dang-xuat','POST'); },
    selectOwner(id) { if (mode !== 'demo' || !seeds.some(r => r.id === id)) return; state.ownerId = id; persist(); },
    reset() { if (mode !== 'demo') return; state = fresh(); persist(); },
    demoOwners() { return seeds.map(r => ({id:r.id, phone:r.phone, title:r.title})); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    link(path) {
      if (mode !== 'demo' || location.protocol !== 'file:') return path;
      // File URLs may have separate storage areas. Carry only demo room changes on explicit navigation.
      const bytes = new TextEncoder().encode(JSON.stringify(state));
      let text=''; for (const byte of bytes) text += String.fromCharCode(byte);
      return path+'#ancu-demo='+btoa(text);
    },
    image(src, parent = true) {
      if(typeof src!=='string' || !src)return '';
      // The same original bytes are used on both pages, including file:// and nested app paths.
      const match=src.match(/(?:^|\/)assets\/rooms\/([a-zA-Z0-9_.-]+)(?:[?#].*)?$/);
      if(!match)return src;
      const name=match[1];
      if(window.AnCuRoomImages?.[name])return window.AnCuRoomImages[name];
      try{return new URL((parent?'../':'')+'assets/rooms/'+name,location.href).href;}
      catch{return (parent?'../':'')+'assets/rooms/'+name;}
    }
  };
  window.AnCuListings = service;
  window.addEventListener('storage', event => { if (mode === 'demo' && event.key === KEY) { readState(); emit(); } });
})();
