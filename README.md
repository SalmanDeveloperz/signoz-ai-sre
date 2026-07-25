# signoz-ai-sre

An AI SRE demo: a fake ticket-answering service (`worker-service`) breaks on command, SigNoz detects it, a second agent (`watcher-service`) diagnoses and fixes it automatically through a shared settings service (`control-plane`). Built for a SigNoz/OpenTelemetry hackathon.

Full data contracts: [`CONTRACTS.md`](CONTRACTS.md). Agent/AI coding rules: [`AGENTS.md`](AGENTS.md).

---

## 1. The mental model (read this first)

Three tiny Node/Express services, one shared Postgres database, one shared network with SigNoz.

```
                 ticket traffic
                       |
                       v
   +------------------------------------+
   |           worker-service            |  <-- does the actual "work" (fake support tickets)
   |  reads settings before every ticket |
   +------------------+-------------------+
                       |
             traces + errors go to SigNoz
                       |
                       v
   +------------------------------------+
   |               SigNoz                |  <-- watches worker-service's telemetry
   |  fires an alert when something's    |
   |  wrong (error rate up, cost up)     |
   +------------------+-------------------+
                       |
              webhook POST /alerts/webhook
                       v
   +------------------------------------+
   |           watcher-service           |  <-- the "AI SRE": diagnoses + decides a fix
   +------------------+-------------------+
                       |
        reads/writes settings, writes incidents
                       v
   +------------------------------------+
   |            control-plane            |  <-- the only shared state in the whole system
   |     (3 settings + incident log)     |
   +------------------------------------+
                       ^
                       |
        worker-service reads settings from here too
```

**How the 3 services stay in sync:** there is no message queue, no events, no shared memory. Sync happens entirely through **control-plane's Postgres row**, read and written over plain HTTP:

- worker-service calls `GET /settings` at the start of **every single ticket**. It never caches settings between requests. This is deliberately simple: the moment control-plane's row changes, the very next ticket picks it up, no restart, no polling interval to tune.
- watcher-service is the only service allowed to call `PUT /settings`. worker-service never writes to control-plane, and watcher-service never calls worker-service directly.
- Every time watcher-service reacts to an alert, it also calls `POST /incidents`, so there's a permanent audit trail independent of both services' logs.

This is why the whole system can be described in one sentence: **worker-service behaves exactly according to whatever row currently sits in control-plane's `control_settings` table, and watcher-service is the only thing allowed to change that row.**

---

## 2. What "done" means for this hackathon

You'll know this project is finished when you can do this **with zero manual `curl` commands**, live, in front of judges:

1. Ticket traffic flows normally through `worker-service`.
2. You call `POST /debug/break-db` (the one manual trigger that's allowed, it's simulating a real outage).
3. Within seconds, SigNoz's alert rule fires and calls `watcher-service`'s webhook, **automatically**.
4. `watcher-service` diagnoses it as the DB-outage failure (not the cost-spike one), **automatically**.
5. `watcher-service` flips `use_backup_data=true` on control-plane, **automatically**.
6. The very next ticket to `worker-service` succeeds again, using cached data, with no restart.
7. `watcher-service` has written an incident row explaining exactly what it saw and what it did.
8. You can show all of this on screen: SigNoz's trace/alert view, and a live view of the incident log.

Today, steps 1, 2, 6, and 7 (if triggered by hand) work. Steps 3, 4, 5 are the gap. Section 6 below is the exact, concrete plan to close it.

---

## 3. Where is the "AI" in this AI SRE? (honest answer)

Right now: **there isn't one yet, and that's a real gap, not a design choice hiding in plain sight.**

What exists today in `watcher-service/src/services/diagnose.js` is a plain `if/else` stub that doesn't even branch yet, it always returns "no diagnosis". The *comment* in that file explains the original intent: use a deterministic if/else instead of an LLM prompt for the 2 known failure modes, so the live demo never says something unpredictable on stage. That's a legitimate, defensible choice for the *core* 2 demo failures, judges care about reliability more than cleverness in a 3-minute demo slot. But "if/else" is not what most people picture when they hear "AI SRE", so here is exactly where real AI/LLM usage fits without risking the deterministic demo path:

| Where | What it adds | Risk to demo reliability |
|---|---|---|
| **A. Natural-language incident narration** | After the deterministic `diagnose()` picks the fix, send the raw alert + telemetry to an LLM (OpenAI/Anthropic API) and ask it to write the human-readable `diagnosis` sentence stored in the incident (e.g. turn `{ruleName:"db-error-rate"}` into `"customer-db unreachable, 5 consecutive failures over 2 minutes"`). The *decision* stays deterministic; only the *explanation text* is AI-generated. | None. If the LLM call fails or is slow, fall back to a canned string, the fix still applies on time. |
| **B. UC6 stretch: SigNoz-MCP-driven diagnosis for unknown alerts** | `signozClient.js` is a stub today. Once real, an LLM can be given SigNoz's actual query results (via its MCP server, see `AGENTS.md` line 18) and asked to classify *unrecognized* alerts, ones that don't match the 2 known failure names, into "known failure X" or "needs a human". This is additive: the 2 known alerts still go through the fast, deterministic path first. | Low. Only triggers for alerts `diagnose.js`'s if/else doesn't already recognize. |
| **C. Safety-check reasoning** | `safetyCheck.js`'s actual rule stays a hardcoded boolean check (that's the point of UC4, a hard boundary the AI can't cross). An LLM could additionally generate the *reason string* shown for why something was blocked, for a nicer incident report. | None, same pattern as A. |

**Concretely, to add A (the easiest, highest-impact one) do this:**
1. Add `watcher-service/src/clients/llmClient.js`: one function `narrate(alert, action)` that calls an LLM API with a short prompt (alert payload + chosen action in, one sentence out), wrapped in try/catch with a hardcoded fallback string on any failure or timeout.
2. In `remediation.service.js`, after `diagnose()` runs and before `reportIncident()`, call `narrate()` and use its result as the `diagnosis` field instead of the raw stub string.
3. Add an env var for the API key to `watcher-service/.env.example`, keep it out of git.
4. Budget a hard timeout (e.g. 2s) on the LLM call so a slow/hanging API never delays the actual fix being applied, narration is cosmetic, the fix in step 5 of Section 2 must never wait on it.

Without at least (A), be upfront in judging that "AI" here refers to the *architecture* (an autonomous agent watching and correcting another agent's misbehavior, end to end, without a human in the loop) rather than an LLM call. That is still a legitimate and fairly uncommon demo, just be ready for the question.

---

## 4. Status matrix

| Service | Built | Talks to control-plane | Runs in docker-compose | Real SigNoz-driven behavior |
|---|:---:|:---:|:---:|:---:|
| **control-plane** | Yes | n/a (it *is* the store) | Yes | Yes, all 3 services' traces reach SigNoz |
| **worker-service** | Yes | Yes, reads `/settings` per ticket | Yes | Tickets work, `/debug/*` failure switches work |
| **watcher-service** | Yes (skeleton) | Client code exists, unused | Yes | No, diagnose/safety-check/apply/report are stubs |
| **Real AI/LLM usage** | No | | | See Section 3 |

---

## 5. The complete flow today, step by step (what's real vs. stubbed)

```
1.  Client -> POST /tickets (worker-service)                                          [WORKING]
2.  worker-service -> GET /settings (control-plane)                                   [WORKING]
3.  worker-service decides: real lookup, backup data, or fail, per settings           [WORKING]
4.  worker-service response includes cost + db_broken + traces to SigNoz              [WORKING]

5.  Client -> POST /debug/break-db (worker-service)                                   [WORKING, manual trigger]
6.  Next ticket -> 503, db_broken:true, error trace sent to SigNoz                     [WORKING]

7.  SigNoz notices the error-rate spike and fires an alert rule                        [MISSING - no alert rule created yet]
8.  SigNoz -> POST /alerts/webhook (watcher-service)                                   [WORKING if called manually; nothing calls it automatically yet]
9.  watcher-service responds 200 immediately, hands off to remediation.service.js      [WORKING]
10. remediation.service.js Step 1: diagnose(alert)                                     [STUB - always "no diagnosis"]
11. remediation.service.js Step 2: safetyCheck(action, settings)                       [MISSING - commented out]
12. remediation.service.js Step 3: controlPlaneClient.applySetting(...)                [MISSING - commented out]
13. remediation.service.js Step 4: controlPlaneClient.reportIncident(...)              [MISSING - commented out]

14. Next ticket after the fix -> succeeds again using backup data                      [WORKING, only if you flip the setting by hand]
15. GET /incidents shows the full story                                                [WORKING, but nothing writes to it automatically]
```

Lines 7 and 10-13 are the entire gap. Everything before and after them already works.

---

## 6. Exactly how to close the gap (in order, each one unblocks the next)

**Step 1: Capture the real SigNoz alert payload.**
- In the SigNoz UI (`localhost:8080`), create one throwaway alert rule on any metric.
- Point its notification channel at a webhook, use `watcher-service`'s real URL (`http://watcher-service:4002/alerts/webhook` inside the Docker network, or a tool like webhook.site first if you want to inspect it before wiring it live).
- Force it to fire (generate a burst of errors on purpose).
- Copy the exact JSON body SigNoz sends into `CONTRACTS.md` Section 2, including whichever field names the alert rule (`CONTRACTS.md` currently guesses `ruleName`, confirm this against the real payload).
- **Why first:** `diagnose.js` cannot be written correctly against a guessed shape. Guessing here fails silently, exactly the kind of bug that shows up during the live demo and nowhere else.

**Step 2: Create the 2 real SigNoz alert rules.**
- Rule A: worker-service's error rate over a short window (catches `db-error-rate`, Failure A from `CONTRACTS.md` Section 4).
- Rule B: `estimated_cost_usd`'s rate of increase (catches the cost spike, Failure B).
- Both point at watcher-service's webhook URL from Step 1.

**Step 3: Wire `watcher-service/src/services/diagnose.js` for real.**
```js
// replace the TODO with real branches, matching the rule name field from Section 2:
if (ruleName.includes('db-error-rate')) {
  return { diagnosis: '...', action: { key: 'use_backup_data', value: true }, detected_via: ruleName };
}
if (ruleName.includes('cost-spike')) {
  return { diagnosis: '...', action: { key: 'active_model', value: 'gpt-cheap' }, detected_via: ruleName };
}
```

**Step 4: Wire `watcher-service/src/services/safetyCheck.js`'s one real rule.**
```js
if (action.key === 'retry_enabled' && action.value === false && currentSettings.use_backup_data === true) {
  return { allowed: false, reason: 'retry_enabled cannot be disabled while use_backup_data is active' };
}
```

**Step 5: Uncomment steps 2-4 in `remediation.service.js`.** The commented-out lines already show the exact shape needed, this is mostly deleting `//`.

**Step 6: Run the loop with zero manual curls**, per Section 2's definition of done.

**Step 7 (optional but strong for judging):** Section 3's option A, LLM-narrated incident text, plus exporting watcher-service's reasoning as SigNoz logs (not just `docker compose logs`) so its "thinking" is visible on the same screen as the alert that triggered it.

---

## 7. Do we need a UI? Yes, for presenting, not for the system to function.

The system itself doesn't need a UI, all 3 services are pure APIs and that's fine for the automation to work. But for judging, nobody wants to watch you read raw `curl` JSON off a terminal for 3 minutes. Two things are worth having on screen:

1. **SigNoz's own UI** (`localhost:8080`) already gives you: the Services list, live traces per request, and (once alert rules exist) the alert firing in real time. This is free, no build needed, just navigate to it during the demo.
2. **One small incident-timeline page.** Judges want to see: alert fired → diagnosis → action taken → ticket recovers, as a timeline, not a JSON blob. Minimal version: a single static HTML page (no framework needed) that polls `GET http://localhost:4001/incidents` and `GET http://localhost:4001/settings` every couple seconds and renders them as a simple list/timeline with timestamps. This can live at `control-plane/public/index.html` served as static files by Express, or as a totally separate `dashboard/` folder, whichever is less work to wire in given the time left.

**A realistic production framing for the demo pitch** (say this out loud to judges, don't just show code): "Imagine `worker-service` is your real production API, and `control-plane` is your real feature-flag/config service (LaunchDarkly, a database row, whatever you already have). `watcher-service` is the on-call engineer that used to get paged at 3am for exactly these two failure classes, database flakiness and a cost spike from an expensive model, and now doesn't, because the fix for both is a config flip an agent can make faster and more consistently than a half-asleep human. The 3-minute version of the story: the pager doesn't fire anymore, this fires instead."

---

## 8. Use cases

| # | Use case | Trigger | Works today? |
|---|---|---|---|
| UC1 | Normal operation | `POST /tickets` | Yes |
| UC2 | Database outage -> auto-fix | `POST /debug/break-db`, SigNoz alert fires, watcher-service flips `use_backup_data` | Failure + manual fix work. Automatic detection->fix not wired (Section 6, Steps 1-6). |
| UC3 | Cost spike -> auto-fix | `POST /debug/spike-cost`, SigNoz alert fires, watcher-service flips `active_model` | Failure + manual fix work. Automatic detection->fix not wired. |
| UC4 | Safety check blocks an unsafe fix | watcher-service tries `retry_enabled=false` while `use_backup_data=true` | Not wired, Section 6 Step 4. |
| UC5 | Incident history / audit trail | `GET /incidents` | Works, but nothing writes to it automatically yet. |
| UC6 (stretch) | watcher-service queries SigNoz directly, LLM-classifies unknown alerts | `signozClient.js` + Section 3 option B | Stub. |

---

## 9. Running the whole stack

Requires Docker Desktop running and SigNoz already up (`foundryctl cast`, see `casting.yaml`) since `docker-compose.yml` joins SigNoz's existing network.

```bash
docker compose up -d --build
docker compose ps            # all 4 should show Up/healthy: app-postgres, control-plane, watcher-service, worker-service
```

| Service | Port |
|---|---|
| control-plane | `4001` |
| watcher-service | `4002` |
| worker-service | `4000` |
| app-postgres | `5433` (host, avoids a local Postgres install on 5432) |
| SigNoz UI | `8080` |

---

## 10. Thorough test walkthrough (copy-paste in order)

**1. control-plane baseline**
```bash
curl http://localhost:4001/settings
# {"use_backup_data":false,"active_model":"gpt-standard","retry_enabled":true}
```

**2. Normal ticket (UC1)**
```bash
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# 200, estimated_cost_usd: 0.02
```

**3. Database outage + manual fix (UC2, the part that works today)**
```bash
curl -X POST http://localhost:4000/debug/break-db
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# 503, db_broken:true

curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"use_backup_data","value":true,"updated_by":"you"}'
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# 200 again, customer.name: "cached-customer"

# reset
curl -X POST http://localhost:4000/debug/fix-db
curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"use_backup_data","value":false,"updated_by":"you"}'
```

**4. Cost spike + manual fix (UC3)**
```bash
curl -X POST http://localhost:4000/debug/spike-cost
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# estimated_cost_usd jumps to 0.85

curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"active_model","value":"gpt-mini","updated_by":"you"}'
curl -X POST http://localhost:4000/tickets -H "Content-Type: application/json" -d '{"customerId":"c1"}'
# cost back to 0.02 (model no longer gpt-standard)

# reset
curl -X POST http://localhost:4000/debug/fix-cost
curl -X PUT http://localhost:4001/settings -H "Content-Type: application/json" \
  -d '{"key":"active_model","value":"gpt-standard","updated_by":"you"}'
```

**5. Incident log (UC5)**
```bash
curl -X POST http://localhost:4001/incidents -H "Content-Type: application/json" \
  -d '{"detected_via":"manual-test","diagnosis":"db outage","action_taken":"use_backup_data=true","safety_check_result":"allowed","cost_before":0.02,"cost_after":0.02}'
curl http://localhost:4001/incidents
```

**6. watcher-service (stub, logs only)**
```bash
curl http://localhost:4002/watcher/status
curl -X POST http://localhost:4002/alerts/webhook -H "Content-Type: application/json" \
  -d '{"ruleName":"db-error-rate-alert","status":"firing"}'
docker compose logs watcher-service   # "alert webhook received", then "diagnosis: skeleton: no diagnosis yet"
```

**7. Confirm in SigNoz**: open `http://localhost:8080` -> Services tab -> `control-plane`, `worker-service`, `watcher-service` should each be listed once they've handled a request.

```bash
docker compose down   # stop everything, keeps the Postgres volume
```

---

## 11. Per-service deep dives

- **control-plane**: full file-by-file breakdown, request lifecycle, endpoint contracts: [`control-plane/README.md`](control-plane/README.md).
- **worker-service**: full endpoint examples, verified test log: [`worker-service/README.md`](worker-service/README.md).
- **watcher-service**: no dedicated README yet, Section 5 and 6 above cover its files and the exact gap.

---

## 12. Checklist: are we hackathon-ready?

- [x] control-plane built, tested, layered, documented
- [x] worker-service built, tested, reads live settings from control-plane
- [x] watcher-service skeleton built, receives webhooks, responds correctly
- [x] All 4 containers build and run together via `docker compose up`
- [ ] `CONTRACTS.md` Section 2 filled with a real captured SigNoz alert payload (Section 6, Step 1)
- [ ] 2 real SigNoz alert rules created and firing (Section 6, Step 2)
- [ ] `diagnose.js` and `safetyCheck.js` wired for real (Section 6, Steps 3-4)
- [ ] `remediation.service.js` steps 2-4 uncommented and working (Section 6, Step 5)
- [ ] Full loop demoed with zero manual curls (Section 2)
- [ ] At least one real AI/LLM call somewhere in the loop (Section 3, option A minimum)
- [ ] Something on screen besides a terminal for judges (Section 7)
