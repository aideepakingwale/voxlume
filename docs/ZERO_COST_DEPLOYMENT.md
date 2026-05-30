# Zero-Cost Cloud Deployment

This guide deploys VoxLume with all application features enabled:

- React frontend
- Express API
- Socket.IO realtime updates
- Q&A, polls, surveys, word clouds, quizzes, analytics, and exports
- Durable PostgreSQL storage

## Free-Tier Architecture

```text
Browser
  |
  | HTTPS + WebSocket
  v
Render Free Web Service
  - npm ci && npm run build
  - npm start
  - serves dist/ and /api
  - runs Socket.IO
  |
  | DATABASE_URL
  v
Neon Free Postgres
  - durable relational storage
  - automatic schema migrations on app startup
```

## Important Free-Tier Limits

This is a zero-cost, production-like setup. It is not a paid SLA production setup.

- Render Free web services spin down after idle time and can take about a minute to wake up.
- Render Free web services have an ephemeral filesystem, so local SQLite is not used in production.
- Neon Free Postgres has monthly compute/storage limits. Keep usage small and monitor the Neon dashboard.
- Real enterprise compliance, HIPAA readiness, SSO enforcement, and audited SOC/ISO operations require organization-level controls outside this demo codebase.

## What Changed For Cloud Deployment

The app now chooses storage automatically:

- No `DATABASE_URL`: use local SQLite at `data/app.sqlite`.
- `DATABASE_URL` present: use PostgreSQL through `server/postgres-repository.js`.

The `render.yaml` file configures a single Render Free web service. You provide the Neon `DATABASE_URL` in Render as a secret environment variable.

## Step 1: Create A Free Neon Postgres Database

1. Go to [Neon](https://console.neon.tech/).
2. Create a free account.
3. Create a new project.
4. Open the project dashboard.
5. Copy the pooled Postgres connection string.
6. Ensure the connection string includes SSL, for example:

```text
postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
```

Keep this value private. You will paste it into Render as `DATABASE_URL`.

## Step 2: Push This App To GitHub

Render deploys from a Git repository.

```bash
git init
git add .
git commit -m "Prepare VoxLume for zero-cost cloud deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USER/voxlume.git
git push -u origin main
```

If this project is already in Git, only commit and push the latest changes:

```bash
git add .
git commit -m "Add zero-cost deployment support"
git push
```

## Step 3: Create The Render Web Service

Option A is the easiest path.

### Option A: Render Blueprint

1. Go to [Render Blueprint Deploy](https://dashboard.render.com/blueprint/new).
2. Select the GitHub repository that contains this app.
3. Render will detect `render.yaml`.
4. Confirm the web service uses:
   - Plan: `free`
   - Build command: `npm ci && npm run build`
   - Start command: `npm start`
   - Health check path: `/api/health`
5. Set the secret environment variable:

```text
DATABASE_URL=<your Neon pooled connection string>
```

6. Keep these environment variables from `render.yaml`:

```text
NODE_VERSION=24
APP_NAME=VoxLume
PGSSLMODE=require
```

Do not set `VITE_API_URL` on Render. The production frontend automatically uses the deployed Render origin for API and Socket.IO traffic.

7. Click Apply / Deploy.

### Option B: Manual Render Web Service

1. Go to [Render Dashboard](https://dashboard.render.com/).
2. Click New, then Web Service.
3. Connect your GitHub repository.
4. Configure:

```text
Runtime: Node
Instance type: Free
Build command: npm ci && npm run build
Start command: npm start
Health check path: /api/health
```

5. Add environment variables:

```text
NODE_VERSION=24
APP_NAME=VoxLume
DATABASE_URL=<your Neon pooled connection string>
PGSSLMODE=require
```

Do not add `VITE_API_URL` for this Render deployment unless you intentionally host the API on a different domain.

6. Deploy.

## Step 4: Verify The Deployment

After Render reports the service is live, open:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/health
```

Expected response:

```json
{
  "ok": true,
  "events": 1,
  "timestamp": "..."
}
```

Then open:

```text
https://YOUR-RENDER-SERVICE.onrender.com
```

Verify:

1. The host console loads.
2. A seeded demo event is visible.
3. Copy the participant link.
4. Open the participant link in another browser tab.
5. Submit a question.
6. Upvote it.
7. Activate a poll from the host console.
8. Answer it as a participant.
9. Start a quiz and submit an answer.
10. Open Analytics and download CSV, XLSX, and PDF exports.

## Step 5: Keep Cost At Zero

- Do not add a payment method unless you are comfortable with usage-based charges.
- Keep traffic low enough for Render and Neon free-tier limits.
- In Neon, monitor storage and compute usage.
- In Render, monitor free instance hours, bandwidth, and build minutes.
- Do not use Render Free Postgres for this guide if you need durable data beyond 30 days.

## Troubleshooting

### The Render app wakes slowly

This is expected on the Free plan after idle periods. First request after idle can take about a minute.

### Data disappears after redeploy

Check whether `DATABASE_URL` is set. If it is missing, the app falls back to local SQLite, which is not durable on free cloud web services.

### Database connection fails

Check:

```text
DATABASE_URL includes ?sslmode=require
PGSSLMODE=require
```

Then redeploy.

### Socket.IO does not connect

Use the Render web service URL directly over HTTPS. Socket.IO will use secure WebSocket/polling under the same origin.

### Build fails on Node version

Confirm this environment variable exists in Render:

```text
NODE_VERSION=24
```

## Local vs Cloud

Local:

```bash
npm install
npm run dev
```

Cloud-compatible production test locally:

```bash
npm ci
npm run build
npm start
```

Cloud with Postgres:

```bash
DATABASE_URL="postgresql://..." PGSSLMODE=require npm start
```
