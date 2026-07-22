// Pattern: Repository.
// Isolates every raw SQL statement for incidents behind two functions.
// Exposes: createIncident(incident), listIncidents().
// Hides: table name, column names, insert/select SQL.

const pool = require('../db/pool');

async function createIncident(incident) {
  const { detected_via, diagnosis, action_taken, safety_check_result, cost_before, cost_after } = incident;
  const { rows } = await pool.query(
    `INSERT INTO incidents (detected_via, diagnosis, action_taken, safety_check_result, cost_before, cost_after)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [detected_via, diagnosis, action_taken, safety_check_result, cost_before, cost_after]
  );
  return rows[0].id;
}

async function listIncidents() {
  const { rows } = await pool.query('SELECT * FROM incidents ORDER BY started_at DESC');
  return rows;
}

module.exports = { createIncident, listIncidents };
