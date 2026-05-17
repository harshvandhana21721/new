import { Router, type IRouter } from "express";
import { localDb } from "../lib/local-db";

const router: IRouter = Router();

router.get("/stats", (req, res) => {
  res.json(localDb.stats(req.query.appId ? String(req.query.appId) : undefined));
});

export default router;
