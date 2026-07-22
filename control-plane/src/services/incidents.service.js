// Pattern: Service Layer.
// Passthrough today since incidents have no business rules yet, only
// persistence. Kept as its own layer so a future rule (e.g. required
// fields, dedup) has one place to live without touching the controller.

const incidentsRepository = require('../repositories/incidents.repository');

async function createIncident(incident) {
  return incidentsRepository.createIncident(incident);
}

async function listIncidents() {
  return incidentsRepository.listIncidents();
}

module.exports = { createIncident, listIncidents };
