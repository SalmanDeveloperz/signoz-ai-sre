// server.js — watcher-service
// Wiring only: mounts routers, JSON parsing, and error middleware. No route
// definitions, no logic. Same philosophy as control-plane's server.js.
// instrumentation.js MUST be required first so OpenTelemetry can auto-instrument
// Express/HTTP before they load.

require('./instrumentation');
require('express-async-errors');

const express = require('express');
const alertsRoutes = require('./routes/alerts.routes');
const statusRoutes = require('./routes/status.routes');

const app = express();
app.use(express.json());
app.use(alertsRoutes);
app.use(statusRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => console.log(`watcher-service listening on port ${PORT}`));
