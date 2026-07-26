# Setup

Everything needed to get this project running from a clean checkout: the 4 app services (`control-plane`, `worker-service`, `watcher-service`, `frontend`), the 2 SigNoz alert rules, and the SigNoz dashboard. This file is setup only, exact commands and exact SigNoz UI field values. For what the system does and how to use it once it's running, see [`README.md`](README.md).

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Get a SigNoz instance running](#2-get-a-signoz-instance-running)
3. [Configure secrets](#3-configure-secrets)
4. [Run everything with Docker (recommended)](#4-run-everything-with-docker-recommended)
5. [Run everything locally, without Docker](#5-run-everything-locally-without-docker)
6. [Set up the 2 SigNoz alert rules](#6-set-up-the-2-signoz-alert-rules)
7. [Set up the SigNoz dashboard](#7-set-up-the-signoz-dashboard)
8. [Verifying the whole setup](#8-verifying-the-whole-setup)

---

## 1. Prerequisites

- **Docker** with Docker Compose v2 (`docker compose`, not the old `docker-compose`), if following the Docker path (Section 4).
- **Node.js 20 or newer** and **npm**, if following the local path (Section 5), or if you want to run the frontend outside Docker.
- **A running SigNoz instance** reachable from wherever these services run. This repo does not start SigNoz itself, see Section 2.

---

## 2. Get a SigNoz instance running

If you don't already have one:

1. Follow [SigNoz's official self-hosting guide](https://signoz.io/docs/install/) (their own `docker-compose` install is the fastest path).
2. Once it's up, note two things you'll need in Section 3 and 4:
   - The name of the Docker network SigNoz's own containers joined.
   - The container name/alias of its OTLP collector (commonly `otel-collector` or similar, but verify, see the gotcha below).

**Known gotcha, found the hard way:** container hostnames are not always what the docs suggest. In this project's own SigNoz install, the collector's real alias turned out to be `signoz-ingester`, and the main SigNoz container's real alias turned out to be `signoz-signoz-0`, not `signoz`. Wrong hostnames don't error, they just make telemetry or Tier 2's SigNoz queries silently return nothing. Verify with:

```bash
docker network inspect <your-signoz-network-name>
```

and update every place below that references `signoz-ingester` / `signoz-signoz-0` to match what you actually find.

---

## 3. Configure secrets

Create a file named `.env` in the repo root (already gitignored, never commit it):

```
SIGNOZ_API_KEY=<see Section 6 for how to generate this>
LLM_PROVIDER=gemini
GOOGLE_API_KEY=<from https://aistudio.google.com/apikey>
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
LLM_MODEL=
```

**Why:** `docker-compose.yml` and the local `.env` files read these. Every field except `LLM_PROVIDER`'s matching key is optional, Tier 1 (the deterministic self-healing) has zero dependency on any of this, and Tier 2 safely no-ops on an unrecognized alert if its key is missing instead of erroring. To use Anthropic or OpenAI instead of Gemini, set `LLM_PROVIDER=anthropic` or `openai` and fill in the matching key, nothing else changes.

---

## 4. Run everything with Docker (recommended)

```bash
docker compose up -d --build
```
**Why `-d`:** runs containers in the background instead of blocking your terminal. **Why `--build`:** rebuilds each service's image from its `Dockerfile`, so local code changes actually take effect. **Outcome:** 5 containers: `app-postgres`, `control-plane`, `watcher-service`, `worker-service`, `frontend`.

```bash
docker compose ps
```
**Outcome:** all 5 rows show `Up` (`app-postgres` shows `Up (healthy)`, it has a healthcheck).

| Service | Port | What it is |
|---|---|---|
| worker-service | `4000` | the API that does the "real work" |
| control-plane | `4001` | shared settings + incident log |
| watcher-service | `4002` | the agent |
| frontend | `5173` | the browser UI |
| app-postgres | `5433` (host side) | control-plane's database |
| SigNoz UI | `8080` | from your existing SigNoz install |

Open `http://localhost:5173` for the UI, or see [README Section 2](README.md#2-quickstart-run-it-end-to-end) for curl-based verification of each endpoint.

**To stop:**
```bash
docker compose down
```
The named Postgres volume (`app-postgres-data`) is preserved, add `-v` to also wipe it.

### Frontend networking, why it just works

`frontend`'s `vite.config.ts` reads `CONTROL_PLANE_URL` / `WORKER_URL` / `WATCHER_URL` env vars for its dev-server proxy targets, defaulting to `localhost` ports for a plain `npm run dev` on your host. Inside `docker-compose.yml`, the `frontend` service overrides these to the other services' container names (`http://control-plane:4001`, etc.), since "localhost" inside a container means the container itself, not its siblings. You don't need to touch this unless you rename a service in `docker-compose.yml`.

### Troubleshooting: containers exit right after starting

If every container exits with code `255` immediately after `docker compose up`, and manually restarting your SigNoz containers gives an error like `mount ... not a directory`, this is a known Docker Desktop/WSL2 issue: after the WSL2 VM restarts (sleep/wake, resource-saver idling out, a host reboot), its bind-mount table can get out of sync with the host filesystem. Fix: fully restart Docker Desktop (or on Windows, `wsl --shutdown` then relaunch Docker Desktop), start your SigNoz containers again, then re-run `docker compose up -d --build` for this repo.

### Troubleshooting: "port is already allocated" for 5173

Something else on your host (e.g. a local `npm run dev` you forgot was running) already has port 5173. Stop it first:
- **macOS/Linux:** `lsof -ti:5173 | xargs kill`
- **Windows (PowerShell):** `Stop-Process -Id (Get-NetTCPConnection -LocalPort 5173 -State Listen).OwningProcess -Force`

---

## 5. Run everything locally, without Docker

Useful for active development on one service. Each command below assumes you're in that service's own directory.

### 5.1 Postgres

You need a real Postgres reachable at whatever `DATABASE_URL` you set for control-plane. Easiest: still use Docker for just this one piece (run this one from the repo root, not a service subdirectory):
```bash
docker run -d --name app-postgres -p 5433:5432 \
  -e POSTGRES_DB=hackathon -e POSTGRES_USER=hackathon -e POSTGRES_PASSWORD=hackathon \
  -v "$(pwd)/control-plane/migrations:/docker-entrypoint-initdb.d:ro" \
  postgres:16
```

### 5.2 control-plane
```bash
cd control-plane
cp .env.example .env   # then edit DATABASE_URL to point at your Postgres
npm install
npm start
```

### 5.3 worker-service
```bash
cd worker-service
cp .env.example .env   # CONTROL_PLANE_URL should point at control-plane's real address
npm install
npm start
```

### 5.4 watcher-service
```bash
cd watcher-service
cp .env.example .env   # fill in SIGNOZ_API_KEY, LLM_PROVIDER, and the matching provider key
npm install
npm start
```

### 5.5 frontend
```bash
cd frontend
npm install
npm run dev
```
**Why no env vars needed here:** `vite.config.ts`'s proxy defaults already point at `localhost:4000/4001/4002`, exactly where the 3 services above are listening when run this way.

Each service's own `README.md` (where present) and `.env.example` document its full list of environment variables.

---

## 6. Set up the 2 SigNoz alert rules

Both rules point at the same webhook, create the notification channel first.

### 6.1 Create the notification channel

1. SigNoz UI → **Alerts** (left sidebar) → **Notification Channels** tab → **+ New Alert Channel**.
2. **Name:** `watcher-service`
3. **Type:** `Webhook`
4. **Webhook URL:** `http://watcher-service:4002/alerts/webhook` (use whatever hostname/port `watcher-service` is actually reachable at from SigNoz's network, this is the Docker Compose service name)
5. **User Name** / **Password:** leave blank, `watcher-service`'s webhook endpoint doesn't require authentication.
6. **Send resolved alerts:** leave this on (SigNoz's default). `watcher-service`'s `remediation.service.js` already checks the payload's `status` field and correctly no-ops on a `resolved` notification instead of re-applying a fix.
7. Save.

### 6.2 Create `db-error-rate-alert` (Metric-based)

1. **Alerts** → **Alert Rules** tab → **+ New Alert**.
2. Choose **Metric based Alert**.
3. **Data source:** Metrics. **Metric:** `signoz_calls_total`.
4. **Filter:** `service.name = 'worker-service' AND status.code = 'STATUS_CODE_ERROR'`
5. **Aggregate within time series:** `Rate`, every `Auto`.
6. **Aggregate across time series:** `Sum`, by `Everything (no breakdown)`.
7. **Alert condition:** send a notification when the query result is **ABOVE** the threshold(s) **AT LEAST ONCE** during the **Last 5 minutes**, **Rolling**.
8. **Threshold:** severity `critical`, on value **> 0**.
9. **Notification channel:** `watcher-service` (the one created in 6.1).
10. **Name the rule** `db-error-rate-alert` (the exact name `watcher-service`'s `diagnose.js` pattern-matches on, via `alertname.includes('db-error-rate')`).
11. Save.

### 6.3 Create `cost-spike-alert` (Trace-based)

1. **+ New Alert** → choose **Trace-based Alert**.
2. **Filter:** `service.name = 'worker-service'`
3. **Aggregation:** `avg(estimated_cost_usd)`
4. **Alert condition:** same shape as above, **ABOVE** threshold, **AT LEAST ONCE**, **Last 5 minutes**, **Rolling**.
5. **Threshold:** severity `critical`, on value **> 0.5**.
6. **Notification channel:** `watcher-service`.
7. **Name the rule** `cost-spike-alert` (matches `diagnose.js`'s `alertname.includes('cost-spike')`).
8. Save.

**Why the exact rule names matter:** `diagnose.js` identifies which failure an alert represents purely by substring-matching the rule's name (`db-error-rate` / `cost-spike`) against `alerts[0].labels.alertname` in the webhook payload, SigNoz always includes the rule's name there. Any other name falls through to Tier 2 (the LLM investigation), which is also a legitimate way to test Tier 2, see [README Section 2, Step 5](README.md#2-quickstart-run-it-end-to-end).

---

## 7. Set up the SigNoz dashboard

### Method 1: Import via the UI (recommended, no extra credentials needed)

1. Copy the contents of [`signoz/dashboard-ai-sre-observability.json`](signoz/dashboard-ai-sre-observability.json) to your clipboard:
   - **macOS:** `cat signoz/dashboard-ai-sre-observability.json | pbcopy`
   - **Linux (with `xclip`):** `cat signoz/dashboard-ai-sre-observability.json | xclip -selection clipboard`
   - **Windows (PowerShell):** `Get-Content signoz\dashboard-ai-sre-observability.json -Raw | Set-Clipboard`
2. SigNoz UI → **Dashboards** → **+ New dashboard** → **Import JSON**.
3. Paste into the editor → **Import and Next** → confirm on the next screen.

**Outcome:** a dashboard named "AI SRE: Self-Healing Infra Observability" with 7 panels, already querying real data. See [README Section 9.3](README.md#93-dashboard-built-importable) for what each panel shows.

### Method 2: Create it programmatically via the API

This is the same JSON, delivered as an API call instead of pasted into the UI, useful for scripting a fresh environment. It needs an API key with **editor** or **admin** role (unlike the read-only viewer key used for `SIGNOZ_API_KEY` elsewhere in this project, see [README Section 7](README.md#getting-a-signoz-api-key-for-signoz_api_key) for how service account keys are generated, just pick a role with write access this time):

```bash
curl -s -X POST http://localhost:8080/api/v1/dashboards \
  -H "Content-Type: application/json" \
  -H "SIGNOZ-API-KEY: <your editor-or-admin-role key>" \
  --data-binary @signoz/dashboard-ai-sre-observability.json
```

This was verified against a real SigNoz instance while building this dashboard: the same JSON file, posted to this exact endpoint, creates an identical dashboard to the UI import path. A `403`/`401` response means the key's role doesn't have write access, generate a new service account key with the `signoz-editor` (or `admin`) role instead.

---

## 8. Verifying the whole setup

Once Sections 4 (or 5), 6, and 7 are done:

```bash
curl -s http://localhost:4001/settings
```
**Outcome:** `{"use_backup_data":false,"active_model":"gpt-standard","retry_enabled":true}`. If this fails, `control-plane` or its Postgres isn't up.

```bash
curl -s -X POST http://localhost:4000/debug/break-db
```
Then generate a minute or two of traffic (see [README Section 2, Step 3](README.md#2-quickstart-run-it-end-to-end)) and confirm `use_backup_data` flips to `true` on its own, and a row appears from:
```bash
curl -s http://localhost:4001/incidents
```
That confirms the alert rule, the notification channel, and `watcher-service`'s Tier 1 logic are all wired correctly end to end.

Open `http://localhost:8080/dashboard` and confirm the "AI SRE: Self-Healing Infra Observability" dashboard shows real data in at least the "Worker error rate" panel after the test above.

Open `http://localhost:5173` and confirm the status strip shows 3 green dots.

Full usage, demo walkthroughs, and what each part of the system does are in [`README.md`](README.md).
