# VoxLume Production Codebase

This is the production-only deployment source for VoxLume. It uses PostgreSQL and is ready for Render + Neon zero-cost deployment.

## What This Codebase Includes

- React + Vite frontend
- Express API
- Socket.IO realtime updates
- PostgreSQL persistence
- Startup database migrations
- Q&A, upvotes, polls, surveys, word clouds, quizzes, analytics, and exports
- Render Blueprint deployment through `render.yaml`

## Requirements

- Node.js 24 or later
- npm 11 or later
- PostgreSQL connection string

## Required Environment Variables

```text
PORT=4100
APP_NAME=VoxLume
DATABASE_URL=postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require
PGSSLMODE=require
```

`DATABASE_URL` is mandatory in this codebase. The server exits on startup if it is missing.

## Local Production Test With Postgres

```bash
npm install
npm run build
DATABASE_URL="postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require" PGSSLMODE=require npm start
```

On Windows PowerShell:

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require"
$env:PGSSLMODE="require"
npm start
```

Open:

```text
http://localhost:4100
```

## Zero-Cost Cloud Deployment

Use the step-by-step guide:

[docs/ZERO_COST_DEPLOYMENT.md](docs/ZERO_COST_DEPLOYMENT.md)

Recommended free-tier deployment:

- Render Free Web Service for the Node app, React build, REST API, exports, and Socket.IO
- Neon Free Postgres for durable storage

## Render Blueprint

This folder includes:

```text
render.yaml
```

Render settings:

```text
Build command: npm ci && npm run build
Start command: npm start
Health check path: /api/health
Plan: free
```

Set `DATABASE_URL` as a secret environment variable in Render.

Do not set `VITE_API_URL` for the normal Render deployment. The frontend will automatically use the deployed Render origin for API and Socket.IO calls.

## Notes

- This codebase is intentionally production-only.
- It does not include SQLite or local reset scripts.
- Use `../local` for SQLite local deployment.
- Free-tier deployment is production-like, not SLA-backed production.
