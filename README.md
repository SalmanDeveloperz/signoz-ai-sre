# signoz-ai-sre

A self-healing infrastructure system, fully instrumented with OpenTelemetry and observed through SigNoz. One service does real work and can be told to fail on command (`worker-service`). A second service watches it entirely through SigNoz's own alerts and telemetry, never by talking to it directly (`watcher-service`), and fixes it automatically. Known failure patterns are fixed instantly by deterministic rules (Tier 1). Failures nobody anticipated are investigated by an LLM that uses SigNoz's own Query API as its tools (Tier 2), and that investigation is itself traced in SigNoz, so the agent's own reasoning is as observable as the infrastructure it watches. A third service (`control-plane`) holds the shared settings the other two read and write, plus a permanent audit log of every automated action.

Full data contracts: [`CONTRACTS.md`](CONTRACTS.md). Agent/AI coding rules: [`AGENTS.md`](AGENTS.md).

## Table of contents

1. [How it works: the full request flow](#1-how-it-works-the-full-request-flow)
2. [Quickstart: run it end to end](#2-quickstart-run-it-end-to-end)
3. [What's done, what's left](#3-whats-done-whats-left)
4. [Functional requirements, per service](#4-functional-requirements-per-service)
5. [Current architecture + file map](#5-current-architecture--file-map)
6. [Ticket vocabulary + master endpoint reference](#6-ticket-vocabulary--master-endpoint-reference)
7. [The AI / agent layer, in full](#7-the-ai--agent-layer-in-full)
8. [The UI (React/Next.js)](#8-the-ui-reactnextjs)
9. [SigNoz: dashboards, alerts, exceptions, LLM cost](#9-signoz-dashboards-alerts-exceptions-llm-cost)

---

## 1. How it works: the full request flow

This is the fastest way to understand the system: 3 concrete walkthroughs, service by service and file by file, for the 3 things that actually happen at runtime.

**The 4 actors:**
- `worker-service` (port 4000): a stand-in production API. Handles simulated support tickets, can be told to fail on demand.
- `control-plane` (port 4001): the only shared state. 3 settings switches, plus a permanent incident log. Postgres-backed.
- `watcher-service` (port 4002): the agent. Never talks to worker-service directly, it only ever watches it through SigNoz, and only ever acts through control-plane.
- SigNoz (port 8080): the observability platform all 3 services send OpenTelemetry traces to, and the thing that actually notices failures and fires alerts.

### Walkthrough A: a normal request (`POST /tickets`)

1. Caller sends `POST worker-service:4000/tickets` -> handled directly in [`worker-service/src/server.js`](worker-service/src/server.js).
2. That handler calls [`controlPanelClient.js`](worker-service/src/controlPanelClient.js)'s `getSettings()` -> `GET control-plane:4001/settings`.
3. On control-plane: [`routes/settings.routes.js`](control-plane/src/routes/settings.routes.js) -> [`controllers/settings.controller.js`](control-plane/src/controllers/settings.controller.js) -> [`services/settings.service.js`](control-plane/src/services/settings.service.js) -> [`repositories/settings.repository.js`](control-plane/src/repositories/settings.repository.js) -> Postgres, and the 3 current switches come back.
4. Back in worker-service, the handler uses those settings (is `use_backup_data` on? is the fake DB "broken"? is cost "spiked"?) to decide the response, and tags the active span with `ticket.id`, `db.broken`, `model.name`, `estimated_cost_usd`.
5. [`instrumentation.js`](worker-service/src/instrumentation.js), loaded before anything else in the process, has already wired this request as an OpenTelemetry trace and exports it over OTLP to SigNoz's collector. That trace, with those 4 attributes, is now searchable inside SigNoz.
6. Response goes back to the caller. control-plane never learns a ticket happened, it only sees that its settings were read.

**Why this indirection matters:** worker-service and watcher-service never call each other. The only things connecting them are (a) control-plane's shared settings and (b) SigNoz's telemetry. That's what makes Walkthroughs B and C below possible without either service knowing the other exists.

### Walkthrough B: Tier 1, a known failure self-healing with no human involved

1. Someone calls `POST worker-service:4000/debug/break-db` (or `/debug/spike-cost`). This flips an in-memory flag in [`customerDb.js`](worker-service/src/customerDb.js), nothing else changes yet.
2. Normal ticket traffic keeps hitting `POST /tickets` (Walkthrough A). Now some responses fail (`503`, `db_broken: true`) or report a high `estimated_cost_usd`. Every one of these is still a normal trace, exported to SigNoz exactly as before.
3. SigNoz's own alert engine, continuously evaluating 2 rules against that incoming telemetry, notices the threshold crossed: `db-error-rate-alert` (error rate on `worker-service` above 0 over a rolling 5-minute window) or `cost-spike-alert` (`avg(estimated_cost_usd)` above 0.5 over a rolling 5-minute window). Nobody calls these rules. SigNoz fires them on its own.
4. SigNoz calls its configured webhook: `POST watcher-service:4002/alerts/webhook`, with a payload shaped exactly like the real one captured in [`CONTRACTS.md`](CONTRACTS.md) Section 2.
5. [`alerts.controller.js`](watcher-service/src/controllers/alerts.controller.js)'s `receiveAlert()` responds `200` immediately, so SigNoz's webhook call never times out or retries, then hands the payload to [`remediation.service.js`](watcher-service/src/services/remediation.service.js)'s `handleAlert()` asynchronously.
6. `handleAlert()` calls [`diagnose.js`](watcher-service/src/services/diagnose.js)'s `diagnose()`, which reads `alerts[0].labels.alertname`, matches it against `db-error-rate` or `cost-spike`, and returns a diagnosis plus a proposed action, e.g. `{key: 'use_backup_data', value: true}`.
7. `handleAlert()` calls [`safetyCheck.js`](watcher-service/src/services/safetyCheck.js)'s `checkSafety()` against the settings as they stand right now. For these 2 failures it's always allowed, the one hardcoded rule only blocks a specific combination involving `retry_enabled`.
8. If allowed, `controlPlaneClient.js`'s `applySetting()` calls `PUT control-plane:4001/settings`, going through the same routes -> controllers -> services -> repositories -> Postgres path as Walkthrough A. The new value is live immediately.
9. Unconditionally, `controlPlaneClient.js`'s `reportIncident()` calls `POST control-plane:4001/incidents`, writing a permanent row: what was detected, what was diagnosed, what was done, whether it was allowed, and when.
10. The very next `POST /tickets` (step 2 of Walkthrough A) reads the updated setting and behaves correctly. No restart, no deploy, no human touched anything after step 1.

### Walkthrough C: Tier 2, an unrecognized alert gets investigated by an LLM

Steps 1 to 5 are identical to Walkthrough B, except the alert's name matches neither `db-error-rate` nor `cost-spike`.

6. `diagnose.js` falls through and calls [`investigate.js`](watcher-service/src/services/investigate.js)'s `investigate(alertPayload)` instead of returning a Tier 1 result.
7. `investigate.js` calls [`llmClient.js`](watcher-service/src/clients/llmClient.js)'s `getModel()`, which, based on the `LLM_PROVIDER` env var, returns a model handle from `@ai-sdk/google`, `@ai-sdk/anthropic`, or `@ai-sdk/openai`. `investigate.js` itself never imports a provider SDK directly, only `llmClient.js` knows which one is active.
8. `investigate.js` calls the Vercel AI SDK's `generateText()` with that model, a system prompt, the alert payload, and exactly 2 tools: `query_recent_traces` and `query_error_spans`.
9. If the model calls a tool, it hits [`signozClient.js`](watcher-service/src/clients/signozClient.js), which makes a real, read-only `POST` to SigNoz's own `/api/v4/query_range` API (authenticated with `SIGNOZ_API_KEY`) and returns real span rows, e.g. recent traces or error spans for `worker-service`. The model can call these up to 4 times (`MAX_STEPS`) before it must answer.
10. The model's final answer is parsed into `{diagnosis, action}`. If `action.key` isn't one of the 3 known setting keys, it's discarded before it goes anywhere (`VALID_KEYS` allowlist).
11. From here, steps 7 to 10 of Walkthrough B repeat exactly: the same `safetyCheck.js`, the same `controlPlaneClient.js` apply/report calls. Tier 2's output carries no special privilege over Tier 1's.
12. Every step of this, the overall investigation and each individual tool call, is its own OpenTelemetry span (`investigate.tier2`, `signoz.query_recent_traces`, `signoz.query_error_spans`), carrying `gen_ai.request.model`, `gen_ai.usage.input_tokens` / `output_tokens`, and `investigate.provider`. This is what makes the agent's own reasoning process, not just the infrastructure it watches, visible as a trace inside SigNoz.

**Guardrails baked into this flow, not left to the model's judgment:** a fixed 3-key action allowlist, read-only tools only, a hard 10-second timeout on the whole investigation, a safe "no action" fallback if the active provider's API key is missing or the call fails, and the same safety check plus audit log as Tier 1. Full guardrail table in [Section 7](#7-the-ai--agent-layer-in-full).

---

## 2. Quickstart: run it end to end

### Prerequisites

- Docker, with Docker Compose v2 (`docker compose`, not the old `docker-compose`).
- A running SigNoz instance, reachable from Docker, with its OTLP collector and Query API exposed. This repo does not start SigNoz itself, `docker-compose.yml` joins an existing external Docker network that SigNoz's own containers are on.
  - If you don't already have SigNoz running, follow SigNoz's own self-hosting guide (their official `docker-compose` install works fine) and note two things afterward: the name of the Docker network SigNoz's containers joined, and the container name/alias of its OTLP collector.
  - **Known gotcha, found the hard way:** container hostnames are not always what you'd guess. In this project's own SigNoz install, the collector's real alias turned out to be `signoz-ingester`, and the main SigNoz container's real alias turned out to be `signoz-signoz-0`, not `signoz`. Wrong hostnames don't error, they just make telemetry or Tier 2's queries silently return nothing. Verify with `docker network inspect <your-signoz-network-name>` and update `docker-compose.yml`'s `OTEL_EXPORTER_OTLP_ENDPOINT` / `SIGNOZ_URL` values, and `watcher-service/.env.example`'s matching comments, to match what you actually find.

### Step 1: configure secrets (optional, only needed for Tier 2)

Create a file named `.env` in the repo root (already gitignored, never commit it):

```
SIGNOZ_API_KEY=<from SigNoz UI -> Settings -> Service Accounts, see Section 7>
LLM_PROVIDER=gemini
GOOGLE_API_KEY=<from https://aistudio.google.com/apikey>
```

**Why:** every other command below works with no `.env` file at all, Tier 1 has zero dependency on any of this. Without a key for the active provider, Tier 2 still runs, it just safely no-ops on an unrecognized alert instead of investigating (logs `"no automated fix, <provider> API key not configured"`). To use Anthropic or OpenAI instead, set `LLM_PROVIDER=anthropic` or `openai` and the matching `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, nothing else changes.

### Step 2: start everything

```bash
docker compose up -d --build
```
**Why `-d`:** runs the containers in the background instead of blocking your terminal. **Why `--build`:** rebuilds each service's image from its `Dockerfile` first, so any local code change actually takes effect (without it, Compose would happily reuse a stale image). **Outcome:** 4 containers created and started: `app-postgres`, `control-plane`, `watcher-service`, `worker-service`.

```bash
docker compose ps
```
**Why:** confirms all 4 actually started and stayed up, rather than crash-looping silently in the background. **Outcome:** all 4 rows show `Up` (or `Up (healthy)` for `app-postgres`, which has a healthcheck).

| Service | Port |
|---|---|
| worker-service | `4000` |
| control-plane | `4001` |
| watcher-service | `4002` |
| app-postgres | `5433` (host side; kept off `5432` to avoid clashing with a local Postgres install) |
| SigNoz UI | `8080` (from your existing SigNoz install) |

### Step 3: start the frontend (recommended, a clickable alternative to Steps 4-6 below)

```bash
cd frontend
npm install
npm run dev
```
**Why:** the frontend is a separate Vite project (not part of `docker-compose.yml`, it doesn't need a container to develop against), so it's installed and started on its own. **Outcome:** Vite prints a local URL, normally `http://localhost:5173`. Open it: you'll see a live-updating settings panel, an incident timeline with search, a ticket feed, and one-click buttons for every scenario in Steps 4 to 6. It talks to the 3 backend services through Vite's dev proxy (configured in `frontend/vite.config.ts`), so no CORS setup was needed on any Express service. Click **Guide** in the top right for the same walkthrough in-app. See [Section 8](#8-the-ui-reactnextjs) for what's in it.

The rest of this Quickstart uses curl/PowerShell directly against the APIs, useful for scripting or verifying a specific call, everything in Steps 4 to 6 maps 1:1 to a button in the frontend if you'd rather click than type.

### Step 4: verify the happy path

- **macOS / Linux / Windows (Git Bash):**
  ```bash
  curl -s http://localhost:4001/settings
  curl -s -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
  ```
- **Windows (PowerShell):**
  ```powershell
  Invoke-RestMethod -Uri http://localhost:4001/settings
  Invoke-RestMethod -Method Post -Uri http://localhost:4000/tickets -ContentType "application/json" -Body '{"customerId":"c1"}'
  ```
**Why:** the first call proves control-plane is up and serving its 3 default settings. The second proves worker-service can reach control-plane and handle a ticket (Walkthrough A above). **Outcome:** the first returns `{"use_backup_data":false,"active_model":"gpt-standard","retry_enabled":true}`; the second returns a `ticket_id`, a fake `customer`, the active `model`, and a small `estimated_cost_usd`.

### Step 5: trigger Failure A (`db-error-rate`) and watch it self-heal

```bash
curl -s -X POST http://localhost:4000/debug/break-db
```
**Why:** flips worker-service's fake DB into a broken state (Walkthrough B, step 1). **Outcome:** `db broken`. Nothing else happens yet, SigNoz needs actual failing traffic to evaluate its alert rule against.

Generate continuous traffic for a few minutes (a single ticket isn't enough data for a 5-minute rolling alert to evaluate):

- **macOS / Linux:**
  ```bash
  while true; do curl -s -o /dev/null -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'; sleep 1; done
  ```
- **Windows (PowerShell):**
  ```powershell
  while ($true) { Invoke-RestMethod -Method Post -Uri http://localhost:4000/tickets -ContentType "application/json" -Body '{"customerId":"c1"}' | Out-Null; Start-Sleep -Seconds 1 }
  ```
**Why:** every request now fails with `db_broken: true`, giving SigNoz's `db-error-rate-alert` rule a real, sustained error rate to cross its threshold on. **Outcome:** after roughly 1 to 2 minutes, stop the loop (Ctrl+C) and check:
```bash
curl -s http://localhost:4001/settings   # use_backup_data should now be true
curl -s http://localhost:4001/incidents  # newest row explains what happened, with no human intervention
```
That's Walkthrough B happening for real. Reset for next time:
```bash
curl -s -X POST http://localhost:4000/debug/fix-db
curl -s -X PUT http://localhost:4001/settings -H "Content-Type: application/json" -d '{"key":"use_backup_data","value":false,"updated_by":"reset"}'
```

### Step 6: trigger Failure B (`cost-spike`) the same way

Repeat Step 5 with `/debug/spike-cost` and `/debug/fix-cost` instead. **Outcome:** `active_model` flips to `gpt-cheap` instead of `use_backup_data` flipping, everything else about the flow is identical.

### Step 7: trigger Tier 2 (an alert nobody wrote a rule for)

There's no real SigNoz alert rule for an "unrecognized" failure by definition, so this is demoed by posting directly to the same webhook SigNoz would call, with a name Tier 1 doesn't recognize:

- **macOS / Linux / Git Bash:**
  ```bash
  curl -s -X POST http://localhost:4002/alerts/webhook -H "Content-Type: application/json" -d '{"alerts":[{"labels":{"alertname":"high-latency-alert"}}],"commonLabels":{"alertname":"high-latency-alert"}}'
  ```
- **Windows (PowerShell):**
  ```powershell
  $body = '{"alerts":[{"labels":{"alertname":"high-latency-alert"}}],"commonLabels":{"alertname":"high-latency-alert"}}'
  Invoke-RestMethod -Method Post -Uri http://localhost:4002/alerts/webhook -ContentType "application/json" -Body $body
  ```
**Why:** `high-latency-alert` matches neither Tier 1 pattern, forcing Walkthrough C's path through `investigate.js`. **Outcome:** check the logs a few seconds later:
```bash
docker compose logs watcher-service --tail 20
```
Without a provider key configured: `"no automated fix, gemini API key not configured"` (or whichever provider), settings untouched, an incident still logged. With one configured: a real model-generated diagnosis, e.g. *"the worker-service is experiencing high latency, but there are no recent error spans or traces to indicate the cause"*, meaning the model actually called its SigNoz tools, found no evidence, and correctly proposed no action rather than guessing.

### Step 8: set up the SigNoz dashboard

A ready-to-import dashboard definition is committed at [`signoz/dashboard-ai-sre-observability.json`](signoz/dashboard-ai-sre-observability.json), 6 panels wired to the exact span attributes this codebase already emits (no new instrumentation needed, see [Section 9](#9-signoz-dashboards-alerts-exceptions-llm-cost) for what each panel shows).

1. Copy the file's contents to your clipboard:
   - **macOS:** `cat signoz/dashboard-ai-sre-observability.json | pbcopy`
   - **Linux (with `xclip` installed):** `cat signoz/dashboard-ai-sre-observability.json | xclip -selection clipboard` (otherwise just open the file and copy its full contents manually)
   - **Windows (PowerShell):** `Get-Content signoz\dashboard-ai-sre-observability.json -Raw | Set-Clipboard`
2. Open SigNoz at `http://localhost:8080/dashboard` -> **New dashboard** -> **Import JSON**.
3. Paste into the editor, click **Import and Next**, then confirm on the next screen.
**Outcome:** a dashboard named "AI SRE: Self-Healing Infra Observability" appears with all 6 panels already querying real data, no manual panel-building required. Panels will show "No Data" for anything you haven't triggered yet (e.g. "Cost per ticket" needs Step 6's traffic first).

### Step 9: watch it in SigNoz's own UI

Open `http://localhost:8080`. **Services** tab: all 3 app services listed once they've each handled at least one request. **Alerts** tab: both rules and their firing history. **Traces** tab: search `investigate.tier2` to see Tier 2's own reasoning as a trace, with its `gen_ai.*` attributes.

### Step 10: stop everything

```bash
docker compose down
```
**Why:** stops and removes the 4 containers. **Outcome:** the named Postgres volume (`app-postgres-data`) is preserved, so settings and incident history survive the next `docker compose up`. Add `-v` only if you want a fully clean slate (this deletes that volume).

### Troubleshooting: containers exit right after starting

If every container exits with code `255` immediately after `docker compose up`, and manually restarting your SigNoz containers gives an error like `mount ... not a directory`, this is a known Docker Desktop/WSL2 issue: after the WSL2 VM restarts (sleep/wake, resource-saver idling out, a host reboot), its bind-mount table can get out of sync with the host filesystem. Fix: fully restart Docker Desktop (or on Windows, `wsl --shutdown` then relaunch Docker Desktop), start your SigNoz containers again, then re-run `docker compose up -d --build` for this repo. Nothing in this repo's own code causes this, it's one layer down, in Docker itself.

---

## 3. What's done, what's left

| Capability | Status | Where |
|---|---|---|
| A working "production" service that answers requests and can be told to fail on demand | Done | `worker-service` |
| A shared place to store behavior switches and change them live, with no restart | Done | `control-plane` |
| A permanent audit log of every automated action taken | Done, every test alert wrote a real row | `control-plane` |
| 2 real SigNoz alert rules, firing automatically on real telemetry | Done, both confirmed firing without any manual trigger of the webhook itself | SigNoz UI |
| Tier 1: deterministic diagnosis + safety check + fix + report for the 2 known failures | Done, verified live with real SigNoz-fired alerts | `watcher-service/src/services/{diagnose,safetyCheck,remediation.service}.js` |
| Tier 2: an LLM agent that investigates unrecognized alerts using real SigNoz telemetry as tools | Done, verified end to end with a real live model call (Gemini). Provider-agnostic, works the same with Anthropic or OpenAI. | `watcher-service/src/services/investigate.js`, `src/clients/{llmClient,signozClient}.js` |
| SigNoz dashboards for cost, LLM usage, agent activity | Done, 6 panels, importable from [`signoz/dashboard-ai-sre-observability.json`](signoz/dashboard-ai-sre-observability.json), confirmed pulling real data | see [Section 9](#9-signoz-dashboards-alerts-exceptions-llm-cost) |
| A UI for demoing, instead of raw curl/PowerShell | Done, built with Vite + React + shadcn/ui, verified against the live backend | `frontend/`, see [Section 8](#8-the-ui-reactnextjs) |

**Readiness checklist:**
- [x] control-plane built, tested, layered (routes -> controllers -> services -> repositories), documented
- [x] worker-service built, tested, reads live settings from control-plane on every ticket
- [x] watcher-service Tier 1 built, tested, both known failures verified live with real SigNoz-fired alerts
- [x] All 4 containers build and run together via `docker compose up`
- [x] worker-service tags traces with the business labels `CONTRACTS.md` Section 3 defines (`ticket.id`, `db.broken`, `model.name`, `estimated_cost_usd`)
- [x] `CONTRACTS.md` Section 2 filled with a real captured SigNoz alert payload
- [x] Both real SigNoz alert rules created and confirmed firing automatically end to end
- [x] `diagnose.js`, `safetyCheck.js`, `remediation.service.js` fully wired
- [x] Tier 2 built: real SigNoz Query API client, LLM tool-calling loop, guardrails, OpenTelemetry spans
- [x] A provider API key set (Gemini) and a live Tier 2 investigation run end to end with a real model response
- [x] SigNoz dashboard built and importable (6 panels, all confirmed pulling real data)
- [x] React/Next.js UI built with the panels in [Section 8](#8-the-ui-reactnextjs), verified against the live backend
- [ ] Optional: tag each incident with which tier handled it on the backend, so the UI and dashboard no longer need to infer it from diagnosis text (see `inferTier()` in Section 8, and the "N instant fixes vs M AI investigations" dashboard panel in [Section 9](#9-signoz-dashboards-alerts-exceptions-llm-cost))

---

## 4. Functional requirements, per service

Plain-English requirements, written so a non-technical reviewer can check them off one by one. STATUS reflects the real code today, not a plan.

### control-plane (the shared settings + audit log)

| ID | Requirement | Status |
|---|---|---|
| FR-CP-01 | Store exactly 3 configuration switches (`use_backup_data`, `active_model`, `retry_enabled`), with sensible defaults if never set. | Done |
| FR-CP-02 | Let any service read all 3 switches in a single call. | Done |
| FR-CP-03 | Let a caller change exactly one switch at a time; reject unknown switch names loudly (400 error), never silently. | Done |
| FR-CP-04 | Record who changed a switch and when, for audit purposes. | Done |
| FR-CP-05 | Permanently record every automated incident: what was detected, what was diagnosed, what action was taken, whether it was allowed or blocked, and the cost before/after. | Done, verified: every test alert (Tier 1 and Tier 2) wrote a real row |
| FR-CP-06 | Let anyone retrieve the full incident history, most recent first. | Done |

### worker-service (the thing that does real work and can be told to fail)

| ID | Requirement | Status |
|---|---|---|
| FR-WK-01 | Accept a simulated customer-support "ticket" and respond with how it was handled. | Done |
| FR-WK-02 | Check control-plane's current settings before handling each ticket, so behavior changes take effect on the very next request, no restart. | Done |
| FR-WK-03 | When `use_backup_data` is on, skip the simulated database and answer from cached data instead. | Done |
| FR-WK-04 | When the simulated database is marked broken, fail the ticket clearly, with a machine-readable `db_broken: true` flag. | Done |
| FR-WK-05 | Report a simulated per-ticket cost that rises when a cost-spike condition is active and the expensive model is still selected. | Done |
| FR-WK-06 | Provide on-demand controls to turn both failure conditions on and off, for reliable demo triggering. | Done |
| FR-WK-07 | Emit OpenTelemetry traces for every request, tagged with the service name, so SigNoz can see error rates. | Done |
| FR-WK-08 | Tag each trace with the specific business labels `CONTRACTS.md` Section 3 defines (`ticket.id`, `db.broken`, `model.name`, `estimated_cost_usd`) so watcher-service and dashboards can search for them. | Done. `POST /tickets` sets all 4 attributes on the active span. |

### watcher-service (the agent, both tiers)

| ID | Requirement | Status |
|---|---|---|
| FR-WS-01 | Accept SigNoz's alert webhook and respond immediately, before doing any analysis, so SigNoz's call never times out or retries the same alert. | Done |
| FR-WS-02 | Diagnose which of the known failures an alert represents (Tier 1), and decide the one correct fix for it. | Done. Branches on `alerts[0].labels.alertname`, handles `db-error-rate` and `cost-spike`. |
| FR-WS-03 | Check a proposed fix against a hardcoded safety rule before applying it, and refuse unsafe ones. | Done. Blocks `retry_enabled=false` while `use_backup_data=true`. |
| FR-WS-04 | Apply an approved fix by updating the matching setting on control-plane. | Done, verified live for both known failures. |
| FR-WS-05 | Record every alert it handles as an incident on control-plane, whether the fix was applied, blocked, or no action was taken. | Done, verified for Tier 1 and Tier 2 alike. |
| FR-WS-06 | Expose a liveness endpoint independent of alert traffic. | Done |
| FR-WS-07 | For alerts Tier 1 doesn't recognize, investigate using real SigNoz telemetry (traces, error spans) as tools for an LLM, instead of giving up. Provider-agnostic: works with Gemini, Anthropic, or OpenAI without code changes. | Done, verified end to end with a real live model call, see [Section 7](#7-the-ai--agent-layer-in-full). |
| FR-WS-08 | Tier 2's proposed action must be restricted to the same 3 known setting keys as Tier 1, anything else discarded; the whole investigation must have a hard timeout; every LLM/tool call must be traced. | Done: `VALID_KEYS` allowlist, 10s timeout via `Promise.race`, manual OTel spans with `gen_ai.*` attributes on the LLM call and `signoz.*` attributes on each tool call. |

---

## 5. Current architecture + file map

```
   +------------------------------------+
   |           worker-service            |  Node/Express, port 4000
   |  reads settings before every ticket |
   +------------------+-------------------+
                       |
             traces + errors go to SigNoz
                       v
   +------------------------------------+
   |               SigNoz                |  observability platform, port 8080
   |  2 real alert rules live:           |
   |  db-error-rate-alert (Failure A)    |
   |  cost-spike-alert (Failure B)       |
   +--------------------------------------+
                       |
              webhook fires automatically
                       v
   +--------------------------------------------------+
   |                 watcher-service                    |  Node/Express, port 4002
   |                                                      |
   |  Tier 1 (known failures, deterministic, instant):    |
   |    diagnose -> safety-check -> apply -> report       |
   |                                                      |
   |  Tier 2 (unrecognized alerts, LLM-investigated):     |
   |    investigate.js: LLM + SigNoz query tools loop  ---|--> reads traces
   |    (guarded: read-only tools, 3-key action allowlist, |    from SigNoz
   |     10s timeout, every call traced)                  |    (query_range API)
   +------------------+---------------------------------+
                       |
        reads/writes settings, writes incidents
                       v
   +------------------------------------+
   |            control-plane            |  Node/Express, port 4001
   |     (3 settings + incident log)     |
   +------------------------------------+
                       ^
                       |
        worker-service reads settings from here too
```

```
control-plane/
  src/
    instrumentation.js        # connects to SigNoz, must load first
    server.js                 # wiring only: mounts routers, error middleware
    db/pool.js                 # singleton Postgres connection
    routes/{settings,incidents}.routes.js
    controllers/{settings,incidents}.controller.js
    services/{settings,incidents}.service.js
    repositories/{settings,incidents}.repository.js
  migrations/001_init.sql

worker-service/
  src/
    instrumentation.js
    server.js                 # all 5 routes defined directly here
    customerDb.js              # in-memory fake DB + failure switches
    controlPanelClient.js      # only talks to control-plane, one function: getSettings()

watcher-service/
  src/
    instrumentation.js
    server.js
    routes/{alerts,status}.routes.js
    controllers/{alerts,status}.controller.js
    services/
      remediation.service.js   # the loop: diagnose -> safety -> apply -> report
      diagnose.js               # Tier 1 if/else; falls through to Tier 2 when unmatched
      safetyCheck.js            # the one hardcoded safety rule
      investigate.js            # Tier 2 orchestrator, LLM tool-calling loop
    clients/
      controlPlaneClient.js     # PUT /settings, POST /incidents, GET /settings
      llmClient.js               # picks the LLM provider (Gemini/Anthropic/OpenAI) via the Vercel AI SDK
      signozClient.js            # real SigNoz Query API v4 client (read-only)

signoz/
  dashboard-ai-sre-observability.json   # importable dashboard definition, see Section 9

frontend/
  src/
    components/ui/       # shadcn primitives
    components/shared/    # SectionCard, InfoTooltip, SearchBar, StatusBadge, PageHeader, GuideDialog
    features/
      settings/           # SettingsPanel, useSettings
      incidents/           # IncidentTimeline, IncidentCard, useIncidents
      demo-controls/       # DemoControls, useDemoControls
      tickets/             # TicketFeed
      status/              # StatusStrip, useServiceStatus
    lib/
      api.ts                # typed client for all 3 backend services
      types.ts               # Settings, Incident, TicketResponse, inferTier()
      ticketFeedStore.ts
  vite.config.ts            # dev-server proxy to the 3 backend services, no CORS needed
```

Standalone Vite project, see [Section 8](#8-the-ui-reactnextjs) for the full breakdown and how to run it.

---

## 6. Ticket vocabulary + master endpoint reference

**What is a "ticket"?** A simulated customer-support request. It is not stored anywhere permanently, worker-service keeps ticket IDs as an in-memory counter that resets to 0 every time the service restarts. There is no ticket database, only the fake customer-lookup layer described below.

**How is a ticket generated?** By sending `POST /tickets` to worker-service with an optional JSON body `{ "customerId": "<any string>" }`. If `customerId` is omitted, worker-service falls back to using the ticket's own numeric ID as the customer ID for the real-lookup path, or the literal string `"unknown"` for the backup-data path.

**Every possible outcome of `POST /tickets`:**

| Condition | HTTP status | Response shape | Meaning |
|---|---|---|---|
| Normal, `use_backup_data=false`, DB not broken | 200 | `{ticket_id, customer:{id,name}, model, estimated_cost_usd, db_broken:false}` | Happy path |
| `use_backup_data=true` | 200 | same shape, `customer.name` is `"cached-customer"` | This *is* Fix A working |
| DB broken, `use_backup_data=false` | 503 | `{ticket_id, error:"customer db unreachable", model, estimated_cost_usd, db_broken:true}` | This *is* Failure A |
| Cost spiked + `active_model` still `gpt-standard` | 200 | `estimated_cost_usd: 0.85` instead of `0.02` | This *is* Failure B |
| Cost spiked + `active_model` changed | 200 | `estimated_cost_usd: 0.02` | This *is* Fix B working |
| control-plane unreachable | 502 | `{error:"control-plane unreachable"}` | Dependency failure, not a demo scenario |

### Master endpoint reference (every API in the system today)

| Service | Method | Path | Purpose | Who calls it today |
|---|---|---|---|---|
| control-plane | `GET` | `/settings` | Read all 3 current switches | worker-service (every ticket), humans testing |
| control-plane | `PUT` | `/settings` | Change one switch | watcher-service (Tier 1 and Tier 2 both), humans testing |
| control-plane | `POST` | `/incidents` | Log one automated action | watcher-service, humans testing |
| control-plane | `GET` | `/incidents` | List the audit trail | humans testing, future UI |
| worker-service | `POST` | `/tickets` | Handle one simulated support ticket | humans testing, future traffic generator/UI |
| worker-service | `POST` | `/debug/break-db` | Turn on Failure A | humans testing, future UI "Break DB" button |
| worker-service | `POST` | `/debug/fix-db` | Turn off Failure A | humans testing |
| worker-service | `POST` | `/debug/spike-cost` | Turn on Failure B | humans testing, future UI "Spike Cost" button |
| worker-service | `POST` | `/debug/fix-cost` | Turn off Failure B | humans testing |
| watcher-service | `POST` | `/alerts/webhook` | Receive a SigNoz alert | SigNoz itself, confirmed firing automatically for both alert rules |
| watcher-service | `GET` | `/watcher/status` | Liveness probe | humans testing, docker-compose, future UI |
| SigNoz | `POST` | `/api/v4/query_range` | Tier 2's read-only telemetry queries | watcher-service's `signozClient.js` |

---

## 7. The AI / agent layer, in full

### Two tiers, and why both exist

**Tier 1 (deterministic):** the 2 known failures resolve instantly via a plain `if/else` on the alert's rule name. No LLM involved, no unpredictability. See Walkthrough B in [Section 1](#1-how-it-works-the-full-request-flow).

**Tier 2 (LLM-driven):** when an alert's name matches neither known pattern, `diagnose.js` hands off to `investigate.js`, which runs a real LLM tool-calling loop (Gemini by default, swappable to Anthropic or OpenAI) using SigNoz's own Query API as the model's "eyes." See Walkthrough C in [Section 1](#1-how-it-works-the-full-request-flow) for the exact step-by-step.

### Guardrails

| Guardrail | How it's enforced |
|---|---|
| Action allowlist | `investigate.js`'s `VALID_KEYS` list discards any proposed action outside `use_backup_data` / `active_model` / `retry_enabled`, before it ever reaches `remediation.service.js`. control-plane's `PUT /settings` enforces the same allowlist again, independently. |
| Read-only investigation | `signozClient.js` only ever calls `query_range`. There is no function in this codebase that can write to SigNoz. |
| Bounded tools | The LLM is given exactly 2 tools: `query_recent_traces`, `query_error_spans`. No shell, no file access, no arbitrary HTTP. |
| Hard timeout | The whole investigation races against a 10s timer (`INVESTIGATION_TIMEOUT_MS`). On timeout it resolves to a safe "no action, needs human" result instead of hanging. |
| Missing API key = safe no-op | If the API key for the active `LLM_PROVIDER` isn't set, `investigate.js` skips straight to the fallback result, logging which provider's key was missing. |
| No privileged path for AI-proposed actions | Tier 2's output goes through the exact same `safetyCheck.js` as Tier 1, in the exact same `remediation.service.js` code path. No special case. |
| Unconditional audit trail | `reportIncident()` fires whether the outcome was applied, blocked, or "insufficient evidence." Nothing is silently dropped, for either tier. |
| Everything is traced | Every LLM call and every SigNoz tool call gets its own OpenTelemetry span, so the agent's own investigation is visible as a trace in SigNoz, not just the infra it's investigating. |

**Will the agent modify code? No.** Its entire vocabulary of possible actions, in either tier, is 3 named config switches on control-plane. It cannot write files, run shell commands, deploy, or touch source code. Safety comes from a small, enumerable action space, not from hoping a model behaves.

### Provider-agnostic by design

`investigate.js` never imports an LLM provider's SDK directly. It imports `generateText`/`tool` from the [Vercel AI SDK](https://sdk.vercel.ai) (`ai` package) and calls `llmClient.getModel()`, which is the only place that knows about `@ai-sdk/google`, `@ai-sdk/anthropic`, or `@ai-sdk/openai`. Switching models is one env var:

| `LLM_PROVIDER` | Package used | Default model | Key env var |
|---|---|---|---|
| `gemini` (default) | `@ai-sdk/google` | `gemini-2.5-flash` | `GOOGLE_API_KEY` |
| `anthropic` | `@ai-sdk/anthropic` | `claude-sonnet-5` | `ANTHROPIC_API_KEY` |
| `openai` | `@ai-sdk/openai` | `gpt-4o-mini` | `OPENAI_API_KEY` |

Override the model for any provider with `LLM_MODEL`. Note: `gemini-2.0-flash` returned a quota-exceeded error (`limit: 0`) on a real free-tier Google account during testing, even with a fresh API key, this is why `gemini-2.5-flash` is the default instead. If you hit the same error, try a different `LLM_MODEL` override or check your key's plan at [aistudio.google.com/apikey](https://aistudio.google.com/apikey).

**Verified live:** a synthetic unrecognized alert was fired at `watcher-service` with a real Gemini key configured. The model called its `query_error_spans` tool, found no matching error traces, and returned a diagnosis stating exactly that, with `action: null`, correctly declining to guess without evidence. The resulting `investigate.tier2` span, with real `gen_ai.request.model` and token-usage attributes, was confirmed queryable in SigNoz.

### Two gotchas found the hard way (worth knowing before you touch this)

1. **SigNoz's internal hostname may not be what you expect.** In this project's own SigNoz install it turned out to be `signoz-signoz-0`, not `signoz`. Found by inspecting the Docker network directly. Getting it wrong doesn't error, it just silently returns zero query results forever.
2. **Trace query timestamps are nanoseconds since epoch, not milliseconds.** Every other timestamp in this codebase is milliseconds. Getting this wrong doesn't error either, `query_range` returns `200 success` with an empty `list`, which looks exactly like "no data in this time range" instead of "your request is malformed."

### Getting a SigNoz API key (for `SIGNOZ_API_KEY`)

1. SigNoz UI -> Settings -> **Service Accounts** -> **New Service Account**, name it e.g. `watcher-service`.
2. Open it -> **Keys** tab -> **Add Key**, name it. Copy the key immediately, it's shown once.
3. Back on the **Overview** tab -> **Roles** -> select `signoz-viewer` (read-only is all this client needs) -> **you must click "Save Changes"**, selecting the role alone does not persist it.
4. Put the key in the root `.env` file (gitignored) as `SIGNOZ_API_KEY=...`. `docker-compose.yml` reads it from there.

---

## 8. The UI (React/Next.js)

The system works without a UI, all 3 services are pure APIs, everything in [Section 2](#2-quickstart-run-it-end-to-end) is demoable with curl or PowerShell alone. The UI exists to make it watchable instead of a terminal full of JSON. It lives in [`frontend/`](frontend), a standalone Vite project, and is started with `cd frontend && npm install && npm run dev` (Step 3 of the Quickstart).

### Stack

Vite + React + TypeScript, [shadcn/ui](https://ui.shadcn.com) (built on Radix UI primitives) for accessible components, Tailwind CSS v4 for styling, [TanStack Query](https://tanstack.com/query) for live-polling data fetching, [Sonner](https://sonner.emilkowal.ski) for toast feedback, `lucide-react` for icons. One permanent dark blue theme (no light/dark toggle, this is an operations console, not a marketing site).

Every call to the 3 backend services goes through Vite's own dev-server proxy (`frontend/vite.config.ts`), so the browser only ever talks to `localhost:5173`, same-origin. None of the 3 Express services needed any CORS changes.

### Structure (feature-based)

```
frontend/src/
  components/
    ui/           # shadcn primitives (button, card, tooltip, checkbox, radio-group, ...)
    shared/        # this app's own reusable pieces built on top of ui/:
                     SectionCard (the one card shell every panel uses),
                     InfoTooltip (the "(i)" affordance next to any non-obvious control),
                     SearchBar, StatusBadge, PageHeader, GuideDialog
  features/
    settings/       # SettingsPanel + useSettings (poll + mutate control-plane)
    incidents/      # IncidentTimeline + IncidentCard + useIncidents (poll + client-side search/filter)
    demo-controls/  # DemoControls + useDemoControls (one hook per backend action)
    tickets/        # TicketFeed (reads a small client-only pub-sub store, worker-service keeps no ticket history of its own)
    status/         # StatusStrip + useServiceStatus (health-check polling)
  lib/
    api.ts          # typed fetch wrappers for control-plane / worker-service / watcher-service
    types.ts         # Settings, Incident, TicketResponse, and inferTier() (see note below)
    ticketFeedStore.ts
```

Every panel is a `SectionCard`: an icon, a title, an optional "(i)" tooltip explaining what the panel is for, and its content. That's what makes the whole page read as one system instead of 6 differently-built widgets.

### What's in it

| Panel | Talks to | What it shows |
|---|---|---|
| Control-plane settings | `GET`/`PUT control-plane:4001/settings`, polled every 2s | The 3 shared switches as a checkbox (`use_backup_data`), a checkbox (`retry_enabled`), and a radio group (`active_model`). Editable directly too, exactly like a human operator using `PUT /settings` would. |
| Incident timeline | `GET control-plane:4001/incidents`, polled every 2s | Every incident, most recent first, with a Tier 1/Tier 2 badge, an allowed/blocked badge, a search box that filters client-side across diagnosis/action/source, and an "Open in SigNoz" link per row. |
| Demo controls | `POST worker-service:4000/debug/*`, `POST worker-service:4000/tickets`, `POST watcher-service:4002/alerts/webhook` | One button per scenario: Break DB, Fix DB, Spike cost, Fix cost, send one ticket, an auto-send toggle (sends a ticket once a second, so a real SigNoz alert can fire on its own without a terminal loop), and Trigger unrecognized alert (forces Tier 2). |
| Live ticket feed | Local only | Every ticket sent from this browser tab, since worker-service itself keeps no ticket history (see Section 6). |
| Status strip | `GET control-plane:4001/settings`, any response from worker-service, `GET watcher-service:4002/watcher/status` | A green/red dot per service, polled every 5s, so a presenter can confirm everything is healthy before starting. |
| Guide dialog | Static content | An in-app version of this README's "How it works" and "Try it yourself" walkthroughs, so nobody has to leave the browser to understand what they're looking at. |

**Note on tier badges:** the backend doesn't tag which tier handled an incident yet (see [Section 3](#3-whats-done-whats-left)'s optional polish item), so `lib/types.ts`'s `inferTier()` infers it client-side from the diagnosis text, Tier 1's two known failures always produce one of two exact strings, anything else is Tier 2. This is a display-only inference and doesn't affect any backend behavior.

### Functional requirements for the UI

| ID | Requirement | Status |
|---|---|---|
| FR-UI-01 | Display all 3 current settings, refreshing automatically without a page reload. | Done |
| FR-UI-02 | Display the incident list as a human-readable timeline, most recent first, refreshing automatically, tagged by which tier handled it. | Done |
| FR-UI-03 | Provide one-click buttons for both failure triggers and both failure fixes, plus one for triggering an unrecognized alert to force Tier 2 to run live. | Done |
| FR-UI-04 | Visually distinguish an "allowed" action from a "blocked" one in the incident timeline. | Done |
| FR-UI-05 | Never require the presenter to open a terminal during a live walkthrough. | Done |

Verified live: every panel confirmed against the real running backend, including watching the Settings panel flip `use_backup_data` to `true` on its own within 2 seconds of an external alert firing, with no interaction on the page, proving the polling and not just the buttons actually works.

---

## 9. SigNoz: dashboards, alerts, exceptions, LLM cost

### 9.1 Alerts (already built, reference)

| Alert | Type | Query | Threshold | Channel |
|---|---|---|---|---|
| `db-error-rate-alert` | Metric-based | `signoz_calls_total`, filter `service.name='worker-service' AND status.code='STATUS_CODE_ERROR'`, Rate/Sum | `> 0`, 5min rolling | `watcher-service` webhook |
| `cost-spike-alert` | Trace-based | `avg(estimated_cost_usd)`, filter `service.name='worker-service'` | `> 0.5`, 5min rolling | `watcher-service` webhook |

Both point at `http://watcher-service:4002/alerts/webhook`. To add a 3rd alert (e.g. for a future failure mode), repeat the same pattern, reuse the existing webhook channel, and give `diagnose.js` a matching branch, or let Tier 2 handle it as unrecognized.

### 9.2 Exceptions

SigNoz's Exceptions tab tracks errors recorded via OpenTelemetry's `span.recordException()` API. This codebase calls it explicitly in `investigate.js`'s catch block, so any failure inside Tier 2 (a malformed LLM response, a network error calling the LLM provider, a bug) shows up there too, not just in `docker compose logs`. Useful for debugging a misbehaving investigation without needing container log access.

### 9.3 Dashboard (built, importable)

[`signoz/dashboard-ai-sre-observability.json`](signoz/dashboard-ai-sre-observability.json) is a real dashboard definition exported from a working SigNoz instance. Import steps are in [Section 2, Step 8](#2-quickstart-run-it-end-to-end). It has 6 panels, all traces-based, all confirmed pulling real data:

| Panel | Query | What it shows |
|---|---|---|
| Worker error rate (Failure A) | `count()`, filter `service.name = 'worker-service' AND has_error = 'true'` | Failure A spiking and recovering |
| Cost per ticket over time (Failure B) | `avg(estimated_cost_usd)`, filter `service.name = 'worker-service'` | Failure B's cost spike and the fix bringing it back down |
| LLM token usage | `sum(gen_ai.usage.input_tokens)` and `sum(gen_ai.usage.output_tokens)`, filter `name = 'investigate.tier2'` | Real LLM calls happening, not faked |
| LLM investigation latency | `avg(duration_nano)`, filter `name = 'investigate.tier2'` | Tier 2's real-world response time |
| Agent tool-call volume | `count()` split across `name = 'signoz.query_recent_traces'` / `'signoz.query_error_spans'` | How many times the agent looked at telemetry before deciding |
| Tier 2 investigations vs total alerts received | `count()` on `name = 'investigate.tier2'` vs `name = 'POST'`, both `service.name = 'watcher-service'` | Approximates "N resolved instantly by Tier 1, M needed AI investigation"; an exact split needs the optional tier tag noted in [Section 3](#3-whats-done-whats-left) |

All of these read span **attributes already being set** by the code in this repo, no new instrumentation was needed to build this dashboard, only its definition.

### 9.4 LLM cost, concretely

Whichever provider's per-token pricing (published on each provider's site) multiplied by `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens` (already captured on the `investigate.tier2` span) gives a real dollar cost per investigation. Summing tokens over a time range and multiplying by the active model's rate turns into an actual "here's what this agent cost today" number, worth comparing against `estimated_cost_usd` (the fake business cost `worker-service` reports for its own simulated tickets).

---

Per-service deep dives: [`control-plane/README.md`](control-plane/README.md), [`worker-service/README.md`](worker-service/README.md).
