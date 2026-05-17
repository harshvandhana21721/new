import { Router, type IRouter } from "express";
import { localDb } from "../lib/local-db";

const router: IRouter = Router();

router.post("/seed", (_req, res) => {
  const appId = "SKY-APP-2026-X9F3";
  if (!localDb.getApp(appId)) {
    localDb.createApp({ appId, name: "MR ROBOT", pin: "1234", status: "active" });
  }
  res.json({ ok: true, message: "Local database is ready" });
});

export default router;
