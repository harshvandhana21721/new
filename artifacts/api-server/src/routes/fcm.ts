import { Router, type IRouter, type Request } from "express";
import { GoogleAuth } from "google-auth-library";
import { localDb } from "../lib/local-db";

const router: IRouter = Router();

type FirebaseCredentials = {
  type: "service_account";
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri?: string;
};

function getFirebaseCredentials(): FirebaseCredentials {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as FirebaseCredentials;
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase FCM env missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY in .env or hosting secrets.");
  }

  return {
    type: "service_account",
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

async function sendFcmToToken(fcmToken: string, data: Record<string, string>, deviceId?: string, req?: Request): Promise<{ messageId: string }> {
  const credentials = getFirebaseCredentials();
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });

  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = tokenResponse.token;
  if (!accessToken) throw new Error("Could not get Google access token for FCM");

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${credentials.project_id}/messages:send`;
  const body = JSON.stringify({ message: { token: fcmToken, data } });

  const fcmRes = await fetch(fcmUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body,
  });

  const fcmBody = await fcmRes.json() as Record<string, unknown>;
  if (!fcmRes.ok) {
    req?.log.warn({ deviceId, fcmStatus: fcmRes.status, fcmBody }, "FCM send failed");
    throw Object.assign(new Error("FCM rejected"), { fcmStatus: fcmRes.status, fcmBody });
  }

  req?.log.info({ deviceId, messageId: fcmBody["name"], data }, "FCM message sent");
  return { messageId: String(fcmBody["name"] ?? "sent") };
}

router.post("/fcm/send", async (req, res) => {
  const { deviceId, data } = req.body as { deviceId?: string; data?: Record<string, string> };
  if (!deviceId) { res.status(400).json({ error: "deviceId is required" }); return; }
  if (!data || typeof data !== "object") { res.status(400).json({ error: "data object is required" }); return; }

  const device = localDb.getDevice(String(deviceId));
  if (!device) { res.status(404).json({ error: "Device not found" }); return; }
  if (!device.fcmToken) { res.status(422).json({ error: "Device has no FCM token registered" }); return; }

  const safeData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) safeData[k] = String(v);

  try {
    const result = await sendFcmToToken(device.fcmToken, safeData, deviceId, req);
    res.json({ success: true, messageId: result.messageId });
  } catch (err: unknown) {
    const e = err as Error & { fcmStatus?: number; fcmBody?: unknown };
    if (e.fcmStatus) { res.status(e.fcmStatus).json({ error: e.fcmBody }); return; }
    res.status(500).json({ error: e.message });
  }
});

router.post("/fcm/online-check", async (req, res) => {
  const { token, data } = req.body as { token?: string; data?: Record<string, string> };
  if (!token) { res.status(400).json({ error: "token is required" }); return; }
  try {
    const safeData: Record<string, string> = {};
    for (const [k, v] of Object.entries(data ?? { type: "online_check" })) safeData[k] = String(v);
    const result = await sendFcmToToken(token, safeData, undefined, req);
    res.json({ success: true, messageId: result.messageId });
  } catch (err: unknown) {
    const e = err as Error & { fcmStatus?: number; fcmBody?: unknown };
    if (e.fcmStatus) { res.status(e.fcmStatus).json({ error: e.fcmBody }); return; }
    res.status(500).json({ error: e.message });
  }
});

export default router;
