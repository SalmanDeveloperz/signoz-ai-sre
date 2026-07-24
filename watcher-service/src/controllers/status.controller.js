// Pattern: Controller (thin). Liveness probe — lets docker/compose and teammates
// confirm the service is up without firing a fake alert.

function getStatus(req, res) {
  res.status(200).json({ status: 'ok' });
}

module.exports = { getStatus };
