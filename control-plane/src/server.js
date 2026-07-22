require('./instrumentation');
require('express-async-errors');

const express = require('express');
const settingsRoutes = require('./routes/settings.routes');
const incidentsRoutes = require('./routes/incidents.routes');

const app = express();
app.use(express.json());
app.use(settingsRoutes);
app.use(incidentsRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal error' });
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => console.log(`control-plane listening on port ${PORT}`));
