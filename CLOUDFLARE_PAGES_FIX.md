# Cloudflare Pages API fix

This build adds Cloudflare Pages Functions at `functions/api/[[path]].ts` so `/api/apps`, `/api/devices`, `/api/register`, `/api/messages`, `/api/data`, `/api/stats`, `/api/sample`, `/api/admin/sessions`, `/api/events`, and `/api/fcm/*` work on the `pages.dev` URL.

Cloudflare Pages settings:

- Framework preset: None
- Build command: `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/mockup-sandbox run build`
- Build output directory: `artifacts/mockup-sandbox/dist`
- Root directory: `/`
- Deploy command: `echo "Cloudflare Pages deploys automatically"`

Environment variables:

- `NODE_VERSION=22`
- `PNPM_VERSION=10.11.1`
- `PORT=5000`
- `BASE_PATH=/`
- `FIREBASE_PROJECT_ID=test-95c77`
- `FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@test-95c77.iam.gserviceaccount.com`
- `FIREBASE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY_HERE\n-----END PRIVATE KEY-----\n`

For persistent live data, create a Cloudflare KV namespace and bind it to Pages as `MRROBOT_KV`. Without KV, the API uses temporary in-memory data and may reset.
