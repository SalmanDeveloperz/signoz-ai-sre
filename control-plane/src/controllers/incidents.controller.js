// Pattern: Controller (thin controller).
// Only req/res handling: reads the request, calls one service function,
// writes the response. No SQL, no business rules.

const incidentsService = require('../services/incidents.service');

async function createIncident(req, res) {
  const id = await incidentsService.createIncident(req.body);
  res.status(201).json({ id });
}

async function listIncidents(req, res) {
  res.status(200).json(await incidentsService.listIncidents());
}

module.exports = { createIncident, listIncidents };
