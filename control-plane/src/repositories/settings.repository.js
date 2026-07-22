// Pattern: Repository.
// Isolates every raw SQL statement for control_settings behind two functions.
// Exposes: getSettings(), setSetting(key, value, updatedBy).
// Hides: table name, column names, the upsert SQL, and the string<->boolean coercion.

const pool = require('../db/pool');

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
  for (const row of rows) settings[row.key] = coerce(row.key, row.value);
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

module.exports = { getSettings, setSetting };
