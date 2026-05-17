import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getFrontendDistDir(): string {
  const candidates = [
    // When running bundled server from artifacts/api-server/dist/index.mjs
    path.resolve(__dirname, "../../mockup-sandbox/dist"),
    // When running from artifacts/api-server with tsx/dev style tooling
    path.resolve(process.cwd(), "../mockup-sandbox/dist"),
    // When running from repository root
    path.resolve(process.cwd(), "artifacts/mockup-sandbox/dist"),
  ];

  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html"))) ?? candidates[0];
}

const frontendDistDir = getFrontendDistDir();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes stay under /api
app.use("/api", router);

// Serve the built React dashboard from artifacts/mockup-sandbox/dist
app.use(express.static(frontendDistDir));

// SPA fallback: direct URLs like /preview/dashboard/MainAdminPanel should load React.
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api")) {
    next();
    return;
  }

  const indexFile = path.join(frontendDistDir, "index.html");
  if (!fs.existsSync(indexFile)) {
    res.status(404).send(
      `Frontend build not found at ${frontendDistDir}. Run: pnpm run build`,
    );
    return;
  }

  res.sendFile(indexFile);
});

export default app;
