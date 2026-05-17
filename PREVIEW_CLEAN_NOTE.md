# Preview cleanup

Extra preview/design screens were removed from the React preview app.

Remaining live routes:

- `/` → Master Admin Panel
- `/preview/dashboard/MainAdminPanel` → Master Admin Panel
- `/preview/dashboard/WebDashboard?appId=SKY-APP-2026-X9F3` → App dashboard opened from Master Admin

Cloudflare Pages settings:

- Build command: `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/mockup-sandbox run build`
- Output directory: `artifacts/mockup-sandbox/dist`
- Root directory: `/`
