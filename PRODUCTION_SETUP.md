# Production setup

This build does not need `DATABASE_URL`.

Data is saved in the app's own local JSON database file:

```env
LOCAL_DB_FILE=./data/local-db.json
```

Firebase is used only for FCM. Create a `.env` file in the project root, beside `package.json`:

```text
mrrobot-env-fcm-localdb-production-final/.env
```

Use `.env.example` as a template. Do not push `.env` to GitHub.

## Commands

```bash
pnpm install
pnpm run build
pnpm run start
```

## Windows CMD

```cmd
cd /d C:\path\to\project
pnpm install
pnpm run build
pnpm run start
```

## Important

If your hosting filesystem is temporary/serverless, use a VPS or persistent disk for `LOCAL_DB_FILE`, otherwise local JSON data can reset after redeploy.
