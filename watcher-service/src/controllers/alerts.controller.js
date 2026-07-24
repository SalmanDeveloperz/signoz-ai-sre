// Pattern: Controller (thin). Only req/res handling. The one job unique to this
// controller: ACK the webhook IMMEDIATELY (200) before doing any work, then hand
// the alert to the remediation service to run asynchronously. If we made SigNoz
// wait on the full agent loop, its webhook could time out and retry — delivering
// the same alert twice.

const remediation = require('../services/remediation.service');

function receiveAlert(req, res) {
  const alert = req.body;

  res.status(200).json({ received: true }); // respond first, work after
  console.log('alert webhook received:', JSON.stringify(alert));

  remediation
    .handleAlert(alert)
    .catch((err) => console.error('handleAlert failed:', err));
}

module.exports = { receiveAlert };
