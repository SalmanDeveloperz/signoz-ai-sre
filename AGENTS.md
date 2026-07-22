# AGENTS.md

## Purpose of this file

This file exists so any AI coding agent working in this repository, Claude Code, Cursor, Copilot, or anything else, has full project context without a human re-explaining it from scratch every session.

**If you are an AI agent reading this:** read `CONTRACTS.md` in this same folder before writing any code. It has the exact data shapes referenced everywhere below. Do not invent a field name, endpoint path, or data shape that isn't written in `CONTRACTS.md`. If something you need isn't in there yet, stop and ask the human you're working with instead of guessing, a wrong guess here fails silently and is very hard to catch later.

---

## What this project is

Two small agent programs and a shared settings panel, built for a hackathon judged on SigNoz/OpenTelemetry usage.

- **worker-service** answers fake support tickets, and can be told to fail on command (its fake database breaks, or its simulated cost per ticket spikes).
- **watcher-service** watches for SigNoz alerts, figures out what's wrong, checks a safety rule, and applies a fix through the shared **control-plane** settings API.
- **control-plane** owns the shared settings and the incident history, both worker-service and watcher-service depend on it.
- SigNoz sits underneath all three, receiving traces/logs/metrics, firing alerts, and (optionally) letting watcher-service query it through its MCP server.

Full narrative, use cases, and day-by-day plan live in `DAY1-3-BUILD-PLAN.md` if you need more background. The exact data shapes live in `CONTRACTS.md`, that one is the source of truth, not this file.

---

## Repo layout

```
signoz-ai-sre/
  CONTRACTS.md
  AGENTS.md
  casting.yaml
  casting.yaml.lock
  docker-compose.yml
  control-plane/      (owner: you, the human writing this section)
  worker-service/     (owner: Teammate B)
  watcher-service/    (owner: Teammate C)
  failure-injector/
  signoz-config/
```

---

## Current status (keep this section updated as the week goes on)

- **control-plane**: implemented and smoke-tested. All 7 files built, `npm install` done, migration run against a standalone `app-postgres` container (on the `signoz-network` Docker network, host port 55432 mapped since 5432 is taken locally), and all 4 endpoints verified against real data. See `control-plane/README.md` for full details. Not yet run inside its own Docker container, and not yet confirmed in SigNoz's service list (no `docker-compose.yml` exists in the repo yet to wire that up).
- **worker-service**: not started yet.
- **watcher-service**: not started yet.
- **CONTRACTS.md**: Sections 1 (settings), 3 (telemetry labels), 4 (failure scenarios), and 5 (incident report) are finalized. Section 2 (the real SigNoz alert webhook payload) is still a placeholder, it needs a human to manually fire a test alert and paste in the real payload before watcher-service's webhook handler can be finished for real.
- **SigNoz**: assumed self-hosted and running via Foundry (see `casting.yaml`), UI reachable at `http://localhost:8080`.
- **Alert rules / dashboards**: not yet created in SigNoz.

Whoever updates this file: please keep this section honest and current, it's the fastest way for a teammate's agent to know what's safe to build on top of.

---

## Shared conventions, apply these in every service

- Node.js, Express, CommonJS (`require`, not `import`, no `"type": "module"`)
- Every service has `src/instrumentation.js`, and it must be the literal first line `require()`'d in that service's `server.js`
- Ports: `worker-service` = 4000, `control-plane` = 4001, `watcher-service` = 4002
- All configuration (ports, URLs, database connection string) comes from environment variables, documented in each service's `.env.example`, never hardcode a URL or port inside a source file
- Every cross-service call uses exactly the endpoints, field names, and types defined in `CONTRACTS.md`, copy the spelling, don't paraphrase it
- Keep implementations minimal. This is a multi-day hackathon MVP, not a production system: no authentication, no ORM, no extra abstraction layers, no features beyond what `CONTRACTS.md` and the use cases in `DAY1-3-BUILD-PLAN.md` describe

---

## If you are working on `worker-service` (Teammate B, not started yet)

**Read first:** `CONTRACTS.md` Sections 1, 3, and 4.

**Your job:** handle fake support tickets, look up a fake customer, and expose debug endpoints that let the team trigger the two demo failures on command.

**Files to build:**
- `package.json`, `.env.example`, `Dockerfile`
- `src/instrumentation.js` (same pattern as control-plane's, just change the service name)
- `src/customerDb.js`, a fake customer lookup with an on/off broken switch
- `src/controlPanelClient.js`, reads settings from control-plane before handling each ticket
- `src/server.js`, defines `POST /tickets`, `POST /debug/break-db`, `POST /debug/fix-db`, `POST /debug/spike-cost`

**Day 1 goal:** all 4 routes exist and return 200 with fake/hardcoded data, service shows up in SigNoz with the correct service name.

**Day 2 goal:** `/tickets` does a real fake-DB lookup, reads settings from control-plane, actually fails when the DB is set to broken, and actually reports a higher `estimated_cost_usd` after `/debug/spike-cost` is called. Every request gets labeled with the fields from `CONTRACTS.md` Section 3.

**Prompt to hand your agent to get started:**
```
Read CONTRACTS.md Sections 1, 3, and 4 in this repo, and AGENTS.md's
"worker-service" section. Build the worker-service folder: package.json,
.env.example, Dockerfile, src/instrumentation.js (OTEL_SERVICE_NAME=
worker-service), src/customerDb.js, src/controlPanelClient.js, and
src/server.js. Match every field name and endpoint shape exactly as
written in CONTRACTS.md, do not invent your own. Start with a working
skeleton where all 4 routes return 200 with placeholder data, then we'll
wire in the real logic.
```

---

## If you are working on `watcher-service` (Teammate C, not started yet)

**Read first:** `CONTRACTS.md` Sections 1, 2, 3, 4, and 5, all of them, this service depends on the most contracts.

**Important:** Section 2 (the real SigNoz alert payload) may still be a placeholder. Check with whoever owns SigNoz setup before assuming it's final, do not build your webhook parsing logic against a guessed shape.

**Your job:** receive SigNoz's alert webhook, figure out what's wrong, decide a fix, run it past a safety check, apply it through control-plane, and write an incident report.

**Files to build:**
- `package.json`, `.env.example`, `Dockerfile`
- `src/instrumentation.js` (same pattern, service name `watcher-service`)
- `src/signozClient.js`, queries SigNoz's API for recent telemetry (add the MCP path only after the plain API path works)
- `src/diagnose.js`, a plain if/else decision tree for the two known failure modes, not an LLM prompt, for demo reliability
- `src/safetyCheck.js`, one hardcoded rule that can block an unsafe action
- `src/controlPanelClient.js`, reads/writes settings and posts incident reports
- `src/server.js`, defines `POST /alerts/webhook` and `GET /watcher/status`

**Day 1 goal:** `POST /alerts/webhook` returns 200 immediately and logs whatever it receives, no real logic yet.

**Day 2 goal:** a simple, even hardcoded, response to an alert, enough to prove the full loop works end to end.

**Day 3 goal:** real diagnosis using `signozClient.js`, the safety check blocking one deliberately unsafe action, and the second failure mode (cost spike) working.

**Prompt to hand your agent to get started:**
```
Read CONTRACTS.md Sections 1, 2, 3, 4, and 5 in this repo, and AGENTS.md's
"watcher-service" section. Check AGENTS.md's "current status" section for
whether CONTRACTS.md Section 2 has a real payload yet, if it's still a
placeholder, stop and flag that before writing webhook-parsing code.
Build the watcher-service folder: package.json, .env.example, Dockerfile,
src/instrumentation.js (OTEL_SERVICE_NAME=watcher-service),
src/controlPanelClient.js, src/server.js with a POST /alerts/webhook
route that responds 200 immediately and logs the payload. Match every
field name exactly as written in CONTRACTS.md. Leave src/signozClient.js,
src/diagnose.js, and src/safetyCheck.js as empty stub files for now, we
build those on Day 2 and 3.
```

---

## If you are working on `control-plane` (in progress)

**Read first:** `CONTRACTS.md` Sections 1 and 5.

**Status:** implemented and smoke-tested against real Postgres. Endpoints: `GET /settings`, `PUT /settings`, `POST /incidents`, `GET /incidents`, backed by Postgres (`control_settings` and `incidents` tables). Full explanation of every file and request lifecycle is in `control-plane/README.md`.

**Remaining work:** add `control-plane` (and `app-postgres`) to a real `docker-compose.yml` once that file exists, confirm it builds and runs via its own Dockerfile (only tested with a bare `node src/server.js` so far), and confirm the service shows up correctly in SigNoz's service list.

---

## Rules every agent working in this repo must follow

- Never modify a file outside the folder you were asked to work in. If a change in your service seems to require a change in `CONTRACTS.md`, stop and say so, don't just quietly adjust the other service to match.
- Never change a field name, endpoint path, or data shape from `CONTRACTS.md` without a human confirming it with their teammates first, this file is not yours to silently edit.
- If `CONTRACTS.md` Section 2 is still a placeholder, do not guess the SigNoz alert payload's shape. Flag it and wait.
- Prefer the smallest correct implementation. This is a multi-day hackathon, favor something that works end to end over something elaborate that doesn't.
- If you use an AI assistant to write code for this project, remember the hackathon rules require disclosing that in the submission form, this doesn't affect how you code, just don't forget it at submission time.

---

## Definition of done for Day 1

- [ ] `CONTRACTS.md` fully filled in, including a real, tested Section 2 payload
- [ ] All 3 services scaffolded with `instrumentation.js` in place, service name set correctly per service
- [ ] `docker-compose up` brings up all 3 services plus Postgres with no crash loops
- [ ] `POST /tickets` (worker-service) and `POST /alerts/webhook` (watcher-service) both return 200 and show up in SigNoz's service list with the correct names
- [ ] `AGENTS.md`'s "current status" section reflects reality, not what was planned this morning
