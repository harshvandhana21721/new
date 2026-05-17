import { Router, type IRouter } from "express";
import { localDb } from "../lib/local-db";

const router: IRouter = Router();

router.get("/data", (req, res) => {
  const { appId, deviceId } = req.query;
  if (!appId) { res.status(400).json({ error: "appId is required" }); return; }
  res.json(localDb.listFormData({ appId: String(appId), deviceId: deviceId ? String(deviceId) : undefined }));
});

router.post("/data", (req, res) => {
  const { appId, deviceId, data } = req.body as { appId?: string; deviceId?: string; data?: Record<string, unknown> };
  if (!appId || !deviceId) { res.status(400).json({ error: "appId and deviceId are required" }); return; }
  if (!data || typeof data !== "object" || Array.isArray(data)) { res.status(400).json({ error: "data must be a JSON object" }); return; }
  const row = localDb.createFormData({ appId: String(appId), deviceId: String(deviceId), data });
  res.status(201).json(row);
});

router.delete("/data/:id", (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const row = localDb.deleteFormData(id);
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

export default router;
