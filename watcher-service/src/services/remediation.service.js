// Pattern: Service Layer (orchestrator). THIS is the agent loop — the heart of
// watcher-service. It ties the other pieces together in a fixed order:
//
//   1. diagnose      — what is wrong? (services/diagnose.js)
//   2. safety-check  — is the chosen fix allowed? (services/safetyCheck.js)
//   3. apply         — flip the setting via control-plane (clients/controlPlaneClient.js)
//   4. report        — write a permanent incident record (control-plane)
//
// Day 1: diagnose/safetyCheck are stubs, so this runs the shape end-to-end but
// takes no real action. Days 2-3 fill in the branches — the ORDER above never
// changes, which is what makes the agent's behavior predictable and auditable.

const { diagnose } = require('./diagnose');
// const { checkSafety } = require('./safetyCheck');            // wired Day 2
// const controlPlane = require('../clients/controlPlaneClient'); // wired Day 2

async function handleAlert(alert) {
  // Step 1 — diagnose.
  const result = await diagnose(alert);
  console.log(
    `diagnosis: ${result.diagnosis} ` +
      `(action: ${result.action ? `${result.action.key}=${result.action.value}` : 'none'})`
  );

  // Step 2-4 — wired on Day 2/3. Kept as explicit TODOs so the loop's full
  // shape is visible now, even though only Step 1 runs today:
  //
  // const settings = await controlPlane.getSettings();
  // const safety = checkSafety(result.action, settings);
  // if (!safety.allowed) {
  //   console.log(`safety check BLOCKED: ${safety.reason}`);
  // } else if (result.action) {
  //   await controlPlane.applySetting(result.action.key, result.action.value);
  // }
  // await controlPlane.reportIncident({ ...result, safety_check_result: ... });
}

module.exports = { handleAlert };
