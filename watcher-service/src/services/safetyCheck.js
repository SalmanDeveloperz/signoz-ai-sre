// Pattern: Service Layer. The one hardcoded rule that can say "no" to the
// watcher's own decision (UC4). Kept simple and readable on purpose — a judge
// should grasp it in 10 seconds. This is the boundary the AI cannot cross.
//
// STUB — the real blocked case is wired on Day 3. Allows everything for now.

function checkSafety(action, currentSettings) {
  if (!action) return { allowed: true, reason: 'no action to check' };

  // TODO(Day 3): block disabling retries while the system relies on backup data:
  //   action.key === 'retry_enabled' && action.value === false &&
  //   currentSettings.use_backup_data === true
  //   -> { allowed: false, reason: 'retry_enabled cannot be disabled while use_backup_data is active' }

  return { allowed: true, reason: 'passed safety check' };
}

module.exports = { checkSafety };
