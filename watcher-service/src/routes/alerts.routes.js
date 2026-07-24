// Pattern: Router. Maps URL + verb to a controller function, no logic of its own.

const express = require('express');
const router = express.Router();
const alertsController = require('../controllers/alerts.controller');

router.post('/alerts/webhook', alertsController.receiveAlert);

module.exports = router;
