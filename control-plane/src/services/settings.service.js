// Pattern: Service Layer.
// Holds the business rule for this domain: which keys are valid settings.
// Doesn't belong in the controller because the controller shouldn't know
// what a "valid key" is, only that updateSetting() can return an error.
// Doesn't belong in the repository because that's a domain rule, not SQL.

const settingsRepository = require('../repositories/settings.repository');

const VALID_KEYS = ['use_backup_data', 'active_model', 'retry_enabled'];

async function getSettings() {
  return settingsRepository.getSettings();
}

async function updateSetting(key, value, updatedBy) {
  if (!VALID_KEYS.includes(key)) {
    return { error: 'unknown key' };
  }
  await settingsRepository.setSetting(key, value, updatedBy || 'unknown');
  return { settings: await settingsRepository.getSettings() };
}

module.exports = { getSettings, updateSetting };
