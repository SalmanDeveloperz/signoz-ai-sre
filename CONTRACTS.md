# CONTRACTS.md

## 0. Why this document exists (all three of you read this before anything else)

You are building three separate small programs, one person per program, at the same time. Those three programs must talk to each other over the network, correctly, without any of you having read each other's actual code.

If each of you guesses how the other two programs work, the guesses will not match. And a mismatch here is dangerous precisely because it is silent: nothing crashes, no error appears, the two programs just quietly fail to understand each other. You typically discover this kind of bug the night before a demo, when there is no time left to fix it.

This document is the fix. All three of you write it together, on Day 1, before anyone opens a code editor. It pins down, in exact spelling and exact shape, everything that passes between your three programs. Once everyone has agreed to this document, each person can go build their own program alone, fully unblocked, because everyone already knows exactly what to send and exactly what to expect back.

**The one rule for the rest of the week:** nobody changes anything in this document alone. If you discover mid-week that a shape needs to change, say so out loud in your team chat first. Then edit this file. Then tell the other two to re-read it before they touch the code that depends on it. A silent, unannounced change to this document is the single most common way a three-person team like yours loses a full day chasing a bug that was never really a bug.

---

## 0.1 Who needs which section (read this table before diving in)

| Section | You (control-plane) | Teammate B (worker-service) | Teammate C (watcher-service) |
|---|---|---|---|
| 1. Control Panel settings | You build this API. This is your spec to implement. | You read from it constantly. Copy the field names exactly. | You write to it. Copy the field names exactly. |
| 2. SigNoz alert message | Not directly your concern, but you set up the alert rule that sends it. | Not your concern. | This is what wakes your whole program up. You cannot write your webhook handler without this. |
| 3. Telemetry labels | Not your concern. | You write these labels into your code. This is your spec. | You search for these exact labels. If your spelling doesn't match Teammate B's, your diagnosis logic will find nothing and quietly do nothing. |
| 4. The two failure stories | You need this to build your SigNoz alert rules correctly. | You need this to build your `/debug/*` endpoints correctly. | You need this to build your decision logic correctly. |
| 5. Incident report | You build this API. This is your spec to implement. | Not your concern. | You call this every time you act. Copy the field names exactly. |

If a section's table says "not your concern," you still don't need to memorize it, but skim it once anyway. Knowing roughly what the other two are agreeing to helps you catch a mistake in the meeting, instead of three days later.

---

## 0.2 How to actually use this document (do this Day 1 morning, budget about 2 hours)

1. All three of you sit down together, screens visible to each other. Nobody goes off to "just start coding" yet.
2. Go through Sections 1, 3, 4, and 5 below, and for each one, read the "purpose" notes out loud, then agree on the actual values. Where this document already proposes a value, that's a suggestion to speed you up, not something you have to keep, change anything you don't like now, while it's cheap to change.
3. Section 2 cannot be filled in from your desks. Follow the numbered steps inside that section to go get a real, tested payload from SigNoz. Do this before anyone writes the code that depends on it.
4. Once every section is filled in for real (no placeholders left in brackets), go through the sign-off checklist at the very bottom together, out loud.
5. Only after sign-off does anyone open a code editor.

---

## Section 1: The Control Panel settings

**What this section is, in plain words:** there are 3 small shared switches that both worker-service and watcher-service care about. worker-service checks these switches before handling each ticket, to decide how to behave right now. watcher-service is the only program allowed to flip these switches, and it does that when it has decided a fix is needed. control-plane is simply where these switches physically live.

**Why this section has to exist at all:** worker-service and watcher-service are built by two different people this week, who will not be reading each other's code. If they do not agree on the exact spelling of these 3 names, and the exact type of value each one holds, one program will send `useBackupData` and the other will be listening for `use_backup_data`. Nothing will happen, and no error message will tell either of you why. This section removes that risk before it can happen.

**The 3 switches, and the purpose of each one:**

| Switch name | Type | Purpose, in plain words | Example value |
|---|---|---|---|
| `use_backup_data` | `true` or `false` | This is the actual fix Watcher applies for Failure A (the database outage). When `true`, it tells worker-service: stop trying the real (fake) lookup, just use a canned backup answer so tickets stop failing. | `false` |
| `active_model` | text | This is the actual fix Watcher applies for Failure B (the cost spike). It tells worker-service which simulated model to pretend to use, which in turn controls the fake cost number it reports. | `"gpt-standard"` |
| `retry_enabled` | `true` or `false` | Exists mainly so you have a third, slightly more dangerous switch to demonstrate the safety check against in Use Case 4 (see the build plan). It tells worker-service whether to retry once before giving up on a failed lookup. | `true` |

**Reading the settings.** Purpose: this is how worker-service finds out, before handling each ticket, whether Watcher has changed anything since the last request.

```
GET /settings

Response:
{
  "use_backup_data": false,
  "active_model": "gpt-standard",
  "retry_enabled": true
}
```
- Every field in the response exists so worker-service does not have to ask three separate questions. One call, all 3 current switch positions, every time.

**Changing a setting.** Purpose: this is the only door Watcher has into changing worker-service's behavior. Watcher never talks to worker-service directly, it only ever goes through here.

```
PUT /settings

Request body:
{
  "key": "use_backup_data",
  "value": true,
  "updated_by": "watcher"
}
```
- `key`: purpose is telling control-plane *which* of the 3 switches to change. Must be spelled exactly as in the table above.
- `value`: purpose is the new position for that switch.
- `updated_by`: purpose is a small audit trail, so if you're looking at the settings later and something looks wrong, you know whether a human, worker-service, or watcher-service touched it last. Always `"watcher"` for this project, since watcher-service is the only caller, but the field exists so this stays true even if you add a manual override button later.

```
Response (success): 200, followed by the full updated settings object
Response (bad key): 400 { "error": "unknown key" }
```
- The 400 case exists so a typo in `key` fails loudly and immediately, instead of silently doing nothing.

---

## Section 2: The message SigNoz sends when something goes wrong

**What this section is, in plain words:** SigNoz is always watching worker-service in the background. When something crosses a line you configured (too many errors, cost too high), SigNoz does not send an email or a text. It makes a direct network call to watcher-service, carrying a message that describes what it saw. That message is the only thing that wakes watcher-service up. Without it, watcher-service has no idea anything is wrong.

**Why you cannot fill this in from memory or a guess:** this message's exact shape is decided entirely by SigNoz's own software, not by anyone on your team. Every field name and every value in it comes from SigNoz. If you write watcher-service's code against a guessed shape, it will compile fine, run fine, and then silently fail to read the real message the first time SigNoz actually sends one, usually right when you need it most.

**What to do, step by step, before filling in the box below:**
1. In the SigNoz UI, create one throwaway alert rule. Purpose: you just need *any* rule that will fire, it does not need to be useful or related to your real project yet.
2. Point its notification channel at a webhook. Purpose: this is the delivery mechanism you're about to test. If watcher-service isn't running yet, point it at a free tool like webhook.site instead, purpose: it will show you the exact raw message SigNoz sends, with nothing hidden.
3. Force the rule to fire, for example by generating a burst of errors on purpose. Purpose: you need to see a real firing event, not just a saved rule.
4. Copy the exact message body you receive, character for character, and paste it below. Purpose: this becomes the actual spec Teammate C codes against, instead of a guess.

```
POST /alerts/webhook   (this is the URL on watcher-service that SigNoz will call)

Real payload, copied from an actual db-error-rate-alert firing on 2026-07-25,
triggered by breaking worker-service's fake DB and sending real ticket
traffic until SigNoz's Metric-Based Alert rule crossed its threshold
automatically (no manual webhook test, this is the genuine alert firing):

{
  "receiver": "watcher-service",
  "status": "firing",
  "alerts": [
    {
      "status": "firing",
      "labels": {
        "alertname": "db-error-rate-alert",
        "ruleId": "019f98ae-fd65-7045-900b-449c89fe739b",
        "ruleSource": "http://localhost:8080/alerts/overview?ruleId=019f98ae-fd65-7045-900b-449c89fe739b",
        "severity": "critical",
        "threshold.name": "critical"
      },
      "annotations": {
        "description": "This alert is fired when the defined metric (current value: 0.13333333333333333) crosses the threshold (0)",
        "summary": "This alert is fired when the defined metric (current value: 0.13333333333333333) crosses the threshold (0)"
      },
      "startsAt": "2026-07-25T09:53:15.569266647Z",
      "endsAt": "0001-01-01T00:00:00Z",
      "generatorURL": "http://localhost:8080/alerts/overview?ruleId=019f98ae-fd65-7045-900b-449c89fe739b",
      "fingerprint": "5d66886b4ee5bbd6"
    }
  ],
  "groupLabels": { "ruleId": "019f98ae-fd65-7045-900b-449c89fe739b" },
  "commonLabels": {
    "alertname": "db-error-rate-alert",
    "ruleId": "019f98ae-fd65-7045-900b-449c89fe739b",
    "ruleSource": "http://localhost:8080/alerts/overview?ruleId=019f98ae-fd65-7045-900b-449c89fe739b",
    "severity": "critical",
    "threshold.name": "critical"
  },
  "commonAnnotations": {
    "description": "This alert is fired when the defined metric (current value: 0.13333333333333333) crosses the threshold (0)",
    "summary": "This alert is fired when the defined metric (current value: 0.13333333333333333) crosses the threshold (0)"
  },
  "externalURL": "http://localhost:8080",
  "version": "4",
  "groupKey": "{__receiver__=\"watcher-service\"}:{ruleId=\"019f98ae-fd65-7045-900b-449c89fe739b\"}",
  "truncatedAlerts": 0
}
```

This is SigNoz's standard Alertmanager-compatible webhook envelope: a top-level
`alerts` array (usually 1 item unless grouped), each with its own `labels`
and `annotations`, plus `commonLabels`/`commonAnnotations` mirroring the same
fields when there's only one alert. `diagnose.js` should read the rule name
from `alerts[0].labels.alertname` (or equivalently `commonLabels.alertname`).

**The one field everyone must agree on afterward:** somewhere in that real payload will be a field that names the alert rule (commonly something like `ruleName` or `alertName`). Its purpose is critical: it's the only way `diagnose.js` tells your two demo failures apart, since both alerts arrive at the same URL. Write its exact name here once you've found it:

```
Alert rule name field = alerts[0].labels.alertname  (also mirrored at commonLabels.alertname)
```

**Why this matters more than it looks:** without this field name pinned down correctly, watcher-service's `diagnose.js` cannot distinguish "the database is down" from "the cost spiked," and will either guess wrong or do nothing at all.

---

## Section 3: The exact labels worker-service writes on its own activity

**What this section is, in plain words:** every time worker-service does something, handling a ticket, looking up a customer, it attaches small labels describing what just happened. Think of each label as a sticky note: "this ticket's id is 42," "the database is broken right now," "this cost 0.85 dollars." These labels travel along with everything else to SigNoz. Later, when watcher-service is trying to figure out what went wrong, it searches SigNoz for these exact labels to reconstruct the story.

**Why this table matters more than any other single thing in this document:** if worker-service labels something `db_broken` and watcher-service later searches for `db.broken`, the search comes back empty. watcher-service will then conclude nothing is wrong, even while worker-service is failing every single request. This failure mode produces no error and no crash. It just quietly does nothing, and it is very hard to notice in the middle of a demo. The two people building worker-service and watcher-service should have this exact table open side by side while they write code.

| Label (exact spelling) | Type | Purpose, in plain words | Written by | Read by |
|---|---|---|---|---|
| `ticket.id` | text | Lets you follow one specific ticket's entire journey across all three services, mainly useful for your own debugging and for showing a clean trace during the demo. | worker-service | you, while debugging |
| `db.broken` | `true` or `false` | The actual signal watcher-service's diagnosis logic looks for to confirm Failure A is happening, rather than just trusting the alert payload alone. | worker-service | watcher-service |
| `model.name` | text | Lets you see, on a trace or dashboard, which simulated model handled a given ticket, useful for proving the model-switch fix actually took effect. | worker-service | watcher-service |
| `estimated_cost_usd` | number | The number your cost dashboard graphs, and the number the second SigNoz alert rule watches for a spike. | worker-service | watcher-service |
| `watcher.action` | text | Lets you see, on a trace or log line, exactly which fix watcher-service chose, useful for both your dashboard and for explaining the demo to judges. | watcher-service | you, for the dashboard |
| `safety_check.result` | `"allowed"` or `"blocked"` | This is what makes Use Case 4 (the safety check demo) visible in SigNoz at all. Without this label, the safety check could still work, but nobody watching the screen would be able to see it working. | watcher-service | you, for the dashboard |

---

## Section 4: The two failures we are simulating, described exactly

**What this section is, in plain words:** this is the actual product you are demoing, written down precisely enough that three different people, coding three different programs, will all build the same two stories.

**Why this needs to be this precise:** the Failure Injector script, the SigNoz alert rules, and watcher-service's decision logic all need to agree on exactly the same two scenarios. If one person's mental picture of "the database failure" is even slightly different from another's, for example, one of you imagines it as a slow database and another imagines it as a fully unreachable one, the pieces will technically all "work" on their own and still fail to connect on Day 2.

**Failure A: the database goes down**
- What starts it, and its purpose: someone calls `POST /debug/break-db` on worker-service. Purpose of this endpoint: gives you a reliable, on-demand way to trigger this exact failure during the demo, instead of hoping a real bug happens on cue.
- What changes, and its purpose: every ticket lookup after this fails, and worker-service labels its activity `db.broken = true`. Purpose: gives SigNoz something concrete to alert on, and gives watcher-service something concrete to search for.
- What SigNoz notices: the error rate on the lookup span climbs sharply.
- What watcher-service should decide to do, and why: turn on `use_backup_data`. This is the one fix that actually addresses this specific failure, a model switch would do nothing here.
- What "fixed" looks like: tickets succeed again, now using the backup answer instead of the real lookup.

**Failure B: the cost per ticket spikes**
- What starts it, and its purpose: someone calls `POST /debug/spike-cost` on worker-service. Same purpose as above, a reliable on-demand trigger.
- What changes, and its purpose: worker-service reports a much higher `estimated_cost_usd` per ticket while still using the expensive model. Purpose: gives your second SigNoz alert rule something to fire on.
- What SigNoz notices: the cost metric's rate of change crosses your alert threshold.
- What watcher-service should decide to do, and why: switch `active_model` to the cheaper option. This is the fix that matches this specific failure, turning on `use_backup_data` here would do nothing.
- What "fixed" looks like: the cost metric visibly drops on the next few tickets, this is your live "wow" chart moment.

---

## Section 5: The incident report

**What this section is, in plain words:** every time watcher-service reacts to a problem, whether it successfully fixes something or blocks itself from doing something unsafe, it writes one short, permanent summary of what happened. This is your paper trail. Its whole purpose is to prove, outside of SigNoz and independent of it, that the Watcher did something sensible, and to give you something to point at during the demo that survives even if SigNoz's UI is having a bad moment on stage.

```
POST /incidents

Request body:
{
  "detected_via": "db-error-rate-alert",
  "diagnosis": "customer-db unreachable, 5 consecutive failures",
  "action_taken": "use_backup_data=true",
  "safety_check_result": "allowed",
  "cost_before": 0.02,
  "cost_after": 0.02
}

Response: 201 { "id": 7 }
```

- `detected_via`: purpose is recording which SigNoz alert rule caused this incident, so you can later show "this row came from the same alert you just watched fire."
- `diagnosis`: purpose is a plain-English sentence a judge can read without knowing anything about your code, this is the human-readable version of watcher-service's reasoning.
- `action_taken`: purpose is recording exactly which setting got changed, in a form you can display directly on a slide or dashboard.
- `safety_check_result`: purpose is making Use Case 4 provable after the fact, not just visible in a scrolling log during the live demo.
- `cost_before` / `cost_after`: purpose is giving your incident list the same "before and after" cost story that your live dashboard shows, in case someone wants to check it later instead of catching it live.

```
GET /incidents

Response: a list of all past incidents, most recent first
```
- Purpose: this is what a simple "incident history" view (even a bare JSON page for now, a nicer one comes Day 4) reads from, and it's your evidence trail if a judge asks "how do you know this actually happened more than once."

---

## Sign-off (all three of you check this together before anyone starts coding)

- [ ] All three of you have read this entire document out loud together, once
- [ ] The 3 switch names and types in Section 1 are final, no more changes expected
- [ ] Section 2 contains a real, tested payload copied from an actual SigNoz alert firing, not a guess
- [ ] The alert rule name field in Section 2 has been identified and written down
- [ ] The label table in Section 3 is final, and both the worker-service and watcher-service builders have a copy open while they code
- [ ] Both failure stories in Section 4 are described identically by all three of you, in your own words, out loud
- [ ] Everyone understands the one rule: any future change to this document gets said out loud in the team chat before it's made
