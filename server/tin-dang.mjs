import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hashPassword, DEMO_PASSWORD } from './auth.mjs';
import { PHONG, CHU_CUA_PHONG, NHA_TRO } from './phong.mjs';

// Data extends existing moderation listings instead of creating a second publication system.
export function createListings(db, ApiError, now) {
  db.exec(`CREATE TABLE IF NOT EXISTS listing_details (
    listing_id INTEGER PRIMARY KEY REFERENCES listings(id),
    owner_id TEXT NOT NULL UNIQUE REFERENCES users(id),
    data_json TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1 CHECK(visible IN (0,1)),
    updated_at TEXT NOT NULL
  )`);
  const seeds=JSON.parse(readFileSync(new URL('./tin-dang.seed.json', import.meta.url),'utf8'));
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [i,r] of seeds.entries()) {
      const user=db.prepare('SELECT id FROM users WHERE phone=?').get(r.phone);
      if(user && user.id!==r.ownerId) continue; // Never attach an existing user's account by phone.
      if(!user) db.prepare(`INSERT INTO users(id,role,phone,email,full_name,password_hash,created_at) VALUES(?,?,?,?,?,?,?)`).run(r.ownerId,'landlord',r.phone,`phong${i+1}@ancu.test`,`Chủ trọ ${String(i+1).padStart(2,'0')}`,hashPassword(DEMO_PASSWORD),now().toISOString());
      if(db.prepare('SELECT 1 FROM listing_details WHERE owner_id=?').get(r.ownerId)) continue;
      const previous=db.prepare('SELECT id FROM listings WHERE room_id=?').get(r.id);
      const id=previous?.id ?? Number(db.prepare(`INSERT INTO listings(room_id,landlord_id,title,address,price,area,phone,description,status,created_at,decided_at,decided_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(r.id,r.ownerId,r.title,r.address,r.price,r.area,r.phone,r.description,'approved','2026-08-05T00:00:00.000Z','2026-08-05T00:00:00.000Z','ad-01').lastInsertRowid);
      db.prepare('INSERT INTO listing_details(listing_id,owner_id,data_json,visible,updated_at) VALUES(?,?,?,?,?)').run(id,r.ownerId,JSON.stringify(r),1,now().toISOString());
    }
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
  const all=()=>db.prepare(`SELECT l.*,d.data_json,d.visible,d.updated_at FROM listings l JOIN listing_details d ON d.listing_id=l.id`).all();
  function item(row) {
    const r=JSON.parse(row.data_json);
    return {...r,listingId:row.id,ownerId:row.landlord_id,title:row.title,address:row.address,price:row.price,area:row.area,phone:row.phone,description:row.description,status:row.status,visible:!!row.visible,reason:row.reason,updatedAt:row.updated_at};
  }
  function hydrate() {
    for(const row of all()) {
      const r=item(row);
      PHONG[r.id]={id:r.id,kind:'renter',status:'listing',tenant:null,code:r.id.toUpperCase(),title:r.title,address:r.address,price:r.price,deposit:r.price,phone:r.phone,image:r.images[0]||''};
      CHU_CUA_PHONG[r.id]={nhaTroId:'nt-'+r.id,landlordId:r.ownerId};
      const nt={id:'nt-'+r.id,name:r.title,landlordId:r.ownerId,rooms:[r.id],address:r.address};
      const idx=NHA_TRO.findIndex(x=>x.id===nt.id); if(idx<0) NHA_TRO.push(nt); else NHA_TRO[idx]=nt;
    }
  }
  function validate(r) {
    for(const [key,max] of [['title',200],['address',500],['description',10000],['phone',20],['ward',100],['district',100]]) {
      if(typeof r[key]!=='string' || r[key].length>max || (['title','address','description','phone'].includes(key)&&!r[key].trim())) throw new ApiError(400,'invalid_listing','Kiểm tra tiêu đề, địa chỉ, mô tả và thông tin liên hệ.');
    }
    if(!/^0\d{9}$/.test(r.phone)) throw new ApiError(400,'invalid_phone','Số điện thoại cần có 10 chữ số và bắt đầu bằng 0.');
    if(!Number.isSafeInteger(r.price)||r.price<1||r.price>1000000000||typeof r.area!=='number'||!Number.isFinite(r.area)||r.area<=0||r.area>10000||!Number.isInteger(r.maxPeople)||r.maxPeople<1||r.maxPeople>100) throw new ApiError(400,'invalid_numbers','Giá, diện tích hoặc số người không hợp lệ.');
    const coord=(n,max)=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=max;
    if((r.latitude===null)!==(r.longitude===null)||(r.latitude!==null&&(!coord(r.latitude,90)||!coord(r.longitude,180)))) throw new ApiError(400,'invalid_coordinates','Nhập đủ hai tọa độ hợp lệ hoặc để trống cả hai.');
    if(!Array.isArray(r.images)||r.images.length<1||r.images.length>12||r.images.some(s=>typeof s!=='string'||s.length>1000||!/^\/assets\/rooms\/[a-zA-Z0-9_.-]+\.(webp|jpe?g|png)$/i.test(s))) throw new ApiError(400,'invalid_images','Cần 1–12 ảnh từ thư mục /assets/rooms/.');
    if(!Array.isArray(r.amenities)||r.amenities.length>30||r.amenities.some(s=>typeof s!=='string'||s.length>80)) throw new ApiError(400,'invalid_amenities','Tiện ích không hợp lệ.');
  }
  function mine(ownerId) { const row=all().find(r=>r.landlord_id===ownerId);return row?item(row):null; }
  function save(ownerId,body,create=false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400,'invalid_body','Dữ liệu tin đăng không hợp lệ.');
    const old=mine(ownerId);
    if(create&&old) throw new ApiError(409,'one_listing','Mỗi chủ trọ quản lý một tin. Hãy chỉnh sửa tin hiện có.');
    if(!create&&!old) throw new ApiError(404,'no_listing','Chưa có tin đăng.');
    const keys=['title','address','price','area','phone','description','maxPeople','images','latitude','longitude','ward','district','amenities'];
    const patch=Object.fromEntries(Object.entries(body||{}).filter(([k])=>keys.includes(k)));
    const r={...(old||{id:'pt-'+randomUUID(),ownerId,maxPeople:2,latitude:null,longitude:null,ward:'',district:'',amenities:[],images:[],postedAt:now().toISOString().slice(0,10),sourceNote:''}),...patch};
    validate(r);
    if(Object.hasOwn(body,'visible')&&typeof body.visible!=='boolean') throw new ApiError(400,'invalid_visibility','Trạng thái hiển thị không hợp lệ.');
    const changed=create||keys.some(k=>JSON.stringify(r[k])!==JSON.stringify(old[k]));
    const status=changed?'pending':old.status, visible=body.visible ?? old?.visible ?? true;
    db.exec('BEGIN IMMEDIATE');
    try {
      let id=old?.listingId;
      if(create) id=Number(db.prepare(`INSERT INTO listings(room_id,landlord_id,title,address,price,area,phone,description,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(r.id,ownerId,r.title,r.address,r.price,r.area,r.phone,r.description,status,now().toISOString()).lastInsertRowid);
      else db.prepare(`UPDATE listings SET title=?,address=?,price=?,area=?,phone=?,description=?,status=?,reason=CASE WHEN ? THEN '' ELSE reason END,decided_at=CASE WHEN ? THEN NULL ELSE decided_at END,decided_by=CASE WHEN ? THEN NULL ELSE decided_by END WHERE id=? AND landlord_id=?`).run(r.title,r.address,r.price,r.area,r.phone,r.description,status,changed?1:0,changed?1:0,changed?1:0,id,ownerId);
      db.prepare(`INSERT INTO listing_details(listing_id,owner_id,data_json,visible,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET data_json=excluded.data_json,visible=excluded.visible,updated_at=excluded.updated_at`).run(id,ownerId,JSON.stringify(r),visible?1:0,now().toISOString());
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    hydrate(); return mine(ownerId);
  }
  function publicRooms() {
    return all().filter(row=>row.status==='approved'&&row.visible&&db.prepare("SELECT 1 FROM users WHERE id=? AND status='active'").get(row.landlord_id)).map(row=>{
      const r=item(row);
      return {id:r.id,title:r.title,address:r.address,price:r.price,area:r.area,people:r.maxPeople,phone:r.phone,postedAt:r.postedAt.split('-').reverse().join('/'),desc:r.description,images:r.images,image:r.images[0],ward:r.ward,district:r.district,amenities:r.amenities,latitude:r.latitude,longitude:r.longitude,type:'Phòng trọ',city:'ha-noi',alt:r.title,posted:0,floor:null,distance:null};
    });
  }
  hydrate();
  return {mine,save,publicRooms,hydrate};
}
