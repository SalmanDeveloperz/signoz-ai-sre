const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DEFAULT_SETTINGS = {
  use_backup_data: false,
  active_model: 'gpt-standard',
  retry_enabled: true,
};

function coerce(key, value) {
  if (typeof value !== 'string') return value;
  if (typeof DEFAULT_SETTINGS[key] === 'boolean') return value === 'true';
  return value;
}

async function getSettings() {
  const { rows } = await pool.query('SELECT key, value FROM control_settings');
  const settings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    settings[row.key] = coerce(row.key, row.value);
  }
  return settings;
}

async function setSetting(key, value, updatedBy) {
  await pool.query(
    `INSERT INTO control_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, String(value), updatedBy]
  );
}

async function createIncident(incident) {
  const {
    detected_via,
    diagnosis,
    action_taken,
    safety_check_result,
    cost_before,
    cost_after,
  } = incident;
  const { rows } = await pool.query(
    `INSERT INTO incidents
       (detected_via, diagnosis, action_taken, safety_check_result, cost_before, cost_after)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [detected_via, diagnosis, action_taken, safety_check_result, cost_before, cost_after]
  );
  return rows[0].id;
}

async function listIncidents() {
  const { rows } = await pool.query('SELECT * FROM incidents ORDER BY started_at DESC');
  return rows;
}

module.exports = { getSettings, setSetting, createIncident, listIncidents };
