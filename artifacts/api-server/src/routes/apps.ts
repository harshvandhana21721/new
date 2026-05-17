import { Router, type IRouter } from "express";
import { DEFAULT_APP_ID, localDb } from "../lib/local-db";

const router: IRouter = Router();
const VALIDITY_DAYS = 30;

function isExpired(createdAt: string | Date): boolean {
  const created = new Date(createdAt).getTime();
  const expiry = created + VALIDITY_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() > expiry;
}

function autoDisableIfExpired(appId: string): void {
  const app = localDb.getApp(appId);
  if (app?.appId === DEFAULT_APP_ID) {
    localDb.updateApp(appId, { status: "active" });
    return;
  }
  if (app && app.status === "active" && isExpired(app.createdAt)) {
    localDb.updateApp(appId, { status: "disabled" });
  }
}

router.get("/apps", (_req, res) => {
  const rows = localDb.listApps();
  for (const app of rows) {
    if (app.appId === DEFAULT_APP_ID) {
      localDb.updateApp(app.appId, { status: "active" });
    } else if (app.status === "active" && isExpired(app.createdAt)) {
      localDb.updateApp(app.appId, { status: "disabled" });
    }
  }
  res.json(localDb.listApps());
});

router.get("/apps/:appId", (req, res) => {
  autoDisableIfExpired(req.params.appId);
  const app = localDb.getApp(req.params.appId);
  if (!app) { res.status(404).json({ error: "App not found" }); return; }
  res.json(app);
});

router.post("/apps", (req, res) => {
  const { appId, name, pin, status } = req.body as { appId?: string; name?: string; pin?: string; status?: string };
  if (!appId || !name) { res.status(400).json({ error: "appId and name are required" }); return; }
  try {
    const row = localDb.createApp({ appId, name, pin, status });
    res.status(201).json(row);
  } catch (err) {
    if ((err as Error).message === "APP_EXISTS") { res.status(409).json({ error: "App ID already exists" }); return; }
    throw err;
  }
});

router.patch("/apps/:appId", (req, res) => {
  const { name, pin, status } = req.body as { name?: string; pin?: string; status?: string };
  const updates: { name?: string; pin?: string; status?: string } = {};
  if (name !== undefined) updates.name = name;
  if (pin !== undefined) updates.pin = pin;
  if (status !== undefined) updates.status = status;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }
  const row = localDb.updateApp(req.params.appId, updates);
  if (!row) { res.status(404).json({ error: "App not found" }); return; }
  res.json(row);
});

router.delete("/apps/:appId", (req, res) => {
  const row = localDb.deleteApp(req.params.appId);
  if (!row) { res.status(404).json({ error: "App not found" }); return; }
  res.json({ ok: true });
});

router.post("/apps/:appId/verify-pin", (req, res) => {
  const { pin } = req.body as { pin?: string };
  if (!pin) { res.status(400).json({ error: "PIN required" }); return; }
  autoDisableIfExpired(req.params.appId);
  const app = localDb.getApp(req.params.appId);
  if (!app) { res.status(404).json({ error: "App not found" }); return; }
  if (app.status !== "active") { res.status(403).json({ error: "App is disabled" }); return; }
  if (app.pin !== pin) { res.status(401).json({ error: "Wrong PIN" }); return; }
  res.json({ ok: true, appId: app.appId, name: app.name });
});

export default router;
