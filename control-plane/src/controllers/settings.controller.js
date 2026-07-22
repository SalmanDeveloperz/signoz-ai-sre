// Pattern: Controller (thin controller).
// Only req/res handling: reads the request, calls one service function,
// writes the response. No SQL, no business rules (no VALID_KEYS check here).

const settingsService = require('../services/settings.service');

async function getSettings(req, res) {
  res.status(200).json(await settingsService.getSettings());
}

async function updateSetting(req, res) {
  const { key, value, updated_by } = req.body;
  const result = await settingsService.updateSetting(key, value, updated_by);
  if (result.error) return res.status(400).json({ error: result.error });
  res.status(200).json(result.settings);
}

module.exports = { getSettings, updateSetting };
