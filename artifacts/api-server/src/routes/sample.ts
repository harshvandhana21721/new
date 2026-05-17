import { Router, type IRouter } from "express";
import { localDb } from "../lib/local-db";

const router: IRouter = Router();

router.get("/sample", (req, res) => {
  res.json(localDb.sample(req.query.appId ? String(req.query.appId) : undefined));
});

export default router;
