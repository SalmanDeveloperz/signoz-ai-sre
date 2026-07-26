// Pattern: Client (the "repository" analog: isolates all HTTP calls to one
// external service behind named functions). This is the watcher's ONLY way to
// change worker-service's behavior: through the shared control-plane, never by
// calling worker-service directly. Shapes are fixed by CONTRACTS.md Sections 1 & 5.

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4001';

async function getSettings() {
  const res = await fetch(`${CONTROL_PLANE_URL}/settings`);
  if (!res.ok) throw new Error(`control-plane GET /settings -> ${res.status}`);
  return res.json();
}

async function applySetting(key, value) {
  const res = await fetch(`${CONTROL_PLANE_URL}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, value, updated_by: 'watcher' }),
  });
  if (!res.ok) throw new Error(`control-plane PUT /settings -> ${res.status}`);
  return res.json();
}

async function reportIncident(incident) {
  const res = await fetch(`${CONTROL_PLANE_URL}/incidents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(incident),
  });
  if (!res.ok) throw new Error(`control-plane POST /incidents -> ${res.status}`);
  return res.json();
}

module.exports = { getSettings, applySetting, reportIncident };
