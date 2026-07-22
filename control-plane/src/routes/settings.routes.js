// Pattern: Router (express.Router()).
// Maps URLs to controller functions only, no logic of its own.

const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');

router.get('/settings', settingsController.getSettings);
router.put('/settings', settingsController.updateSetting);

module.exports = router;
