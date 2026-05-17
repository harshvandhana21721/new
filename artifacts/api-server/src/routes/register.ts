import { Router, type IRouter } from "express";
import { localDb, type DeviceRow } from "../lib/local-db";
import { sseEmit } from "../lib/sse";

const router: IRouter = Router();

router.post("/register", (req, res) => {
  const { appId, deviceId, userId, name, androidVersion, sim1Carrier, sim1Phone, sim2Carrier, sim2Phone, fcmToken } = req.body as Record<string, unknown>;
  if (!appId || !deviceId || !name) {
    res.status(400).json({ error: "appId, deviceId and name are required" });
    return;
  }
  const uid = String(userId ?? `USR-${String(deviceId).slice(-6).toUpperCase()}`);
  const now = new Date().toISOString();
  const { row, created } = localDb.upsertDevice({
    appId: String(appId),
    deviceId: String(deviceId),
    userId: uid,
    name: String(name),
    androidVersion: Number(androidVersion ?? 0),
    sim1Carrier: sim1Carrier != null ? String(sim1Carrier) : null,
    sim1Phone: sim1Phone != null ? String(sim1Phone) : null,
    sim2Carrier: sim2Carrier != null ? String(sim2Carrier) : null,
    sim2Phone: sim2Phone != null ? String(sim2Phone) : null,
    fcmToken: fcmToken != null ? String(fcmToken) : null,
    status: "online",
    lastOnline: now,
    forwardEnabled: false,
  });
  sseEmit("device_updated", { deviceId: row.deviceId, appId: row.appId });
  res.status(created ? 201 : 200).json({ ok: true, deviceId: row.deviceId, created });
});

router.post("/heartbeat", (req, res) => {
  const { deviceId, fcmToken } = req.body as Record<string, unknown>;
  if (!deviceId) { res.status(400).json({ error: "deviceId is required" }); return; }
  const updates: Partial<DeviceRow> = { status: "online", lastOnline: new Date().toISOString() };
  if (fcmToken != null) updates.fcmToken = String(fcmToken);
  const row = localDb.updateDevice(String(deviceId), updates);
  if (!row) { res.status(404).json({ error: "Device not found. Call /api/register first." }); return; }
  sseEmit("device_updated", { deviceId: row.deviceId, appId: row.appId });
  res.json({ ok: true });
});

export default router;
