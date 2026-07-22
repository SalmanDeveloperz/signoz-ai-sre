require('./instrumentation');

const express = require('express');
const db = require('./db');

const app = express();
app.use(express.json());

const VALID_KEYS = ['use_backup_data', 'active_model', 'retry_enabled'];

app.get('/settings', async (req, res) => {
  const settings = await db.getSettings();
  res.status(200).json(settings);
});

app.put('/settings', async (req, res) => {
  const { key, value, updated_by } = req.body;
  if (!VALID_KEYS.includes(key)) {
    return res.status(400).json({ error: 'unknown key' });
  }
  await db.setSetting(key, value, updated_by || 'unknown');
  const settings = await db.getSettings();
  res.status(200).json(settings);
});

app.post('/incidents', async (req, res) => {
  const id = await db.createIncident(req.body);
  res.status(201).json({ id });
});

app.get('/incidents', async (req, res) => {
  const incidents = await db.listIncidents();
  res.status(200).json(incidents);
});

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`control-plane listening on port ${PORT}`);
});
