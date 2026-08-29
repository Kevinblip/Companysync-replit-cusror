# Run CompanySync locally in Cursor

Cursor is the editor. Live hosting can stay on Replit (`getcompanysync.com`) until you choose otherwise. This repo path does **not** deploy or change Replit production.

## 1. Open the project

```bash
git clone https://github.com/Kevinblip/Companysync-replit-cusror.git
cd Companysync-replit-cusror
```

Then **File → Open Folder** in Cursor (or clone from the GitHub panel).

## 2. Environment file

```bash
cp .env.example .env
```

Edit `.env`. Required to boot login/sessions:

- `DATABASE_URL` — Postgres connection string
- `SESSION_SECRET` — long random string (do not reuse a production secret)
- `PORT` — `5000` for local Vite / prod-server

Add Google / Twilio / Stripe / GHL names from `.env.example` only if you need those features.

**Do not copy values from `.replit`.** That file currently has `[userenv.shared]` secrets in git. Rotate those production secrets. Never put real secrets in `.env.example`.

`.env` is gitignored. Do not commit it.

## 3. Postgres

Install and start PostgreSQL 16 (or compatible). Create an empty database, for example:

```bash
createdb companysync
```

Point `DATABASE_URL` at that database. On first `npm run dev`, Vite initializes tables via `db/schema.js` (including `users` and `sessions`).

## 4. Install and run (dev)

```bash
npm install
npm run dev
```

Vite listens on **`0.0.0.0:5000`** with `strictPort: true`. Open [http://localhost:5000](http://localhost:5000).

`@base44/sdk` and the Base44 Vite plugin stay in the project. They do not block `npm run dev`. You may see `[base44] Proxy not enabled (VITE_BASE44_APP_BASE_URL not set)` — that is expected locally. Optional flags:

- `BASE44_LEGACY_SDK_IMPORTS=true` — only if leftover code still imports the legacy SDK; leave unset/`false`
- `VITE_BASE44_APP_BASE_URL` — enables the Base44 proxy; not required for the local Postgres path

Replit OIDC (`REPL_ID`) is optional locally. Email/password (`/api/login-local`) and Google OAuth still register without it.

## 5. Production-mode locally (after a build)

```bash
npm run build
npm start
```

- `npm run build` is a normal **`vite build`**. It also copies `prod-server.cjs` and `db/` into `dist/` (see `vite.config.js`). It does **not** push git.
- `npm start` loads `.env` if present, then runs `node prod-server.cjs`.

## 6. Scripts (safe vs Replit-only)

| Script | What it does |
|---|---|
| `npm run dev` | Vite + API plugins on port 5000 |
| `npm run build` | Local production build only |
| `npm start` | Serve the built app with `prod-server.cjs` |
| `npm run deploy:replit` | **Optional.** Runs `scripts/auto-deploy.sh`, which can **force-push `main`**. Do not use from Cursor. |

## Security note

`.replit` `[userenv.shared]` currently stores secrets in the repository. Rotate those values in production. Keep local `.env` private.
