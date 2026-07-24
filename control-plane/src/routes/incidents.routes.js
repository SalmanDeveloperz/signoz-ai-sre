// Pattern: Router (express.Router()).
// Maps URLs to controller functions only, no logic of its own.

const express = require('express');
const router = express.Router();
const incidentsController = require('../controllers/incidents.controller');

router.post('/incidents', incidentsController.createIncident);
router.get('/incidents', incidentsController.listIncidents);

module.exports = router;
