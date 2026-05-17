# Project notes

This final package uses the app's own local JSON data store and does not require a PostgreSQL/Supabase `DATABASE_URL`.

Firebase is used only for FCM push notifications. Put Firebase service-account values in `.env` or hosting secrets.

Commands:

```bash
pnpm install
pnpm run build
pnpm run start
```
