import { randomUUID } from 'crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const TZ = 'Asia/Ho_Chi_Minh';

export function createGoogleCalendar({ db, store, origin }) {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/google-calendar/callback`;
  const webhookUrl = process.env.GOOGLE_CALENDAR_WEBHOOK_URL || '';
  const webhookToken = process.env.GOOGLE_CALENDAR_WEBHOOK_TOKEN || '';
  const configured = () => Boolean(clientId && clientSecret);
  const getAuth = () => db.prepare('SELECT * FROM google_calendar_auth WHERE id = 1').get();
  const saveAuth = (tokens, old = getAuth()) => db.prepare(`INSERT INTO google_calendar_auth
    (id, access_token, refresh_token, expires_at, scope, calendar_id, channel_id, resource_id, channel_expires_at, updated_at)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token, refresh_token=excluded.refresh_token,
      expires_at=excluded.expires_at, scope=excluded.scope, calendar_id=excluded.calendar_id,
      channel_id=excluded.channel_id, resource_id=excluded.resource_id,
      channel_expires_at=excluded.channel_expires_at, updated_at=excluded.updated_at`)
    .run(tokens.access_token ?? old?.access_token ?? null, tokens.refresh_token ?? old?.refresh_token ?? null,
      tokens.expires_at ?? (tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : old?.expires_at ?? null),
      tokens.scope ?? old?.scope ?? SCOPE, old?.calendar_id ?? 'primary', tokens.channel_id ?? old?.channel_id ?? null,
      tokens.resource_id ?? old?.resource_id ?? null, tokens.channel_expires_at ?? old?.channel_expires_at ?? null,
      new Date().toISOString());

  async function tokenRequest(body) {
    const response = await fetch(TOKEN_URL, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || data.error || 'Google OAuth thất bại');
    return data;
  }
  async function accessToken() {
    const auth = getAuth();
    if (!auth) throw new Error('Chưa kết nối Google Calendar');
    if (auth.access_token && Number(auth.expires_at || 0) > Date.now() + 60000) return auth.access_token;
    if (!auth.refresh_token) throw new Error('Google Calendar đã hết phiên, hãy kết nối lại');
    const next = await tokenRequest({ client_id:clientId, client_secret:clientSecret, refresh_token:auth.refresh_token, grant_type:'refresh_token' });
    saveAuth(next, auth);
    return next.access_token;
  }
  async function calendarFetch(path, options = {}) {
    const token = await accessToken();
    const response = await fetch(API + path, { ...options, headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json', ...(options.headers || {}) } });
    if (response.status === 204) return {};
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || `Google Calendar lỗi ${response.status}`);
    return data;
  }
  const pad = (n) => String(n).padStart(2, '0');
  function localIso(date, time) { return `${date}T${time}:00+07:00`; }
  function eventBody(a) {
    const start = new Date(localIso(a.date, a.time));
    const end = new Date(start.getTime() + (a.dur || 30) * 60000);
    return {
      summary:`Xem phòng ${a.roomCode || a.room}`,
      location:a.address || 'Nhà trọ An Cư',
      description:`Khách: ${a.tenant}\nSố điện thoại: ${a.phone}\nTrạng thái: ${a.status}`,
      start:{ dateTime:start.toISOString(), timeZone:TZ }, end:{ dateTime:end.toISOString(), timeZone:TZ },
      extendedProperties:{ private:{ ancuSource:'an-cu', ancuAppointmentId:String(a.id), ancuStatus:a.status } },
    };
  }
  async function pushAppointment(a) {
    if (!getAuth()) return a;
    const body = eventBody(a);
    let event;
    if (a.googleEventId) {
      event = await calendarFetch(`/calendars/primary/events/${encodeURIComponent(a.googleEventId)}?sendUpdates=none`, { method:'PATCH', body:JSON.stringify(body) });
    } else {
      event = await calendarFetch('/calendars/primary/events?sendUpdates=none', { method:'POST', body:JSON.stringify(body) });
    }
    return store.setGoogleEvent(a.id, event.id, event.etag);
  }
  async function pushAll() {
    let updated = 0, skipped = 0;
    for (const item of store.listAll()) {
      if (item.status === 'completed') { skipped++; continue; }
      try { await pushAppointment(item); updated++; } catch { skipped++; }
    }
    return { updated, skipped };
  }
  function localParts(dateTime) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone:TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
      .formatToParts(new Date(dateTime)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    return { date:`${parts.year}-${parts.month}-${parts.day}`, time:`${parts.hour}:${parts.minute}` };
  }
  async function pullChanges() {
    const params = new URLSearchParams({ singleEvents:'true', showDeleted:'true', maxResults:'2500', privateExtendedProperty:'ancuSource=an-cu' });
    const data = await calendarFetch(`/calendars/primary/events?${params}`);
    let updated = 0, skipped = 0;
    for (const event of data.items || []) {
      const appointmentId = Number(event.extendedProperties?.private?.ancuAppointmentId);
      if (!appointmentId) { skipped++; continue; }
      try {
        const when = event.start?.dateTime ? localParts(event.start.dateTime) : {};
        store.applyGoogleChange({ appointmentId, eventId:event.id, etag:event.etag, ...when, status:event.status });
        updated++;
      } catch { skipped++; }
    }
    return { updated, skipped };
  }
  async function startWatch() {
    if (!webhookUrl) return { active:false, reason:'Chưa cấu hình GOOGLE_CALENDAR_WEBHOOK_URL' };
    const auth = getAuth();
    const channelId = randomUUID();
    const data = await calendarFetch('/calendars/primary/events/watch', { method:'POST', body:JSON.stringify({ id:channelId, type:'web_hook', address:webhookUrl, token:webhookToken || undefined }) });
    saveAuth({ channel_id:channelId, resource_id:data.resourceId, channel_expires_at:Number(data.expiration || 0) }, auth);
    return { active:true, expiration:data.expiration };
  }
  return {
    status:() => ({ configured:configured(), connected:Boolean(getAuth()?.refresh_token), webhook:Boolean(webhookUrl) }),
    authUrl(state) { const q = new URLSearchParams({ client_id:clientId, redirect_uri:redirectUri, response_type:'code', access_type:'offline', prompt:'consent', scope:SCOPE, state }); return `${AUTH_URL}?${q}`; },
    async exchange(code) { const tokens = await tokenRequest({ code, client_id:clientId, client_secret:clientSecret, redirect_uri:redirectUri, grant_type:'authorization_code' }); saveAuth(tokens); return tokens; },
    pushAppointment, pushAll, pullChanges, startWatch,
    validWebhook(headers) { const a=getAuth(); return Boolean(a && headers['x-goog-channel-id'] === a.channel_id && (!webhookToken || headers['x-goog-channel-token'] === webhookToken)); },
    configured,
  };
}
