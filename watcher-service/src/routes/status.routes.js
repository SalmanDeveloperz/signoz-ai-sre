// Pattern: Router. Liveness probe route.

const express = require('express');
const router = express.Router();
const statusController = require('../controllers/status.controller');

router.get('/watcher/status', statusController.getStatus);

module.exports = router;
