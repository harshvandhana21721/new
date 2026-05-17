# Demo App Logic

The app `SKY-APP-2026-X9F3` is now pre-created in both environments:

- Local Node server local JSON database (`artifacts/api-server/src/lib/local-db.ts`)
- Cloudflare Pages Functions API (`functions/api/[[path]].ts`)
- Frontend fallback in Master Admin (`MainAdminPanel.tsx`)

So Master Admin will always show this app in the app list, even when KV/local data is empty or older KV data does not contain it.

Default app:

```text
App ID: SKY-APP-2026-X9F3
Name: MR ROBOT
PIN: 1234
Status: active
```
