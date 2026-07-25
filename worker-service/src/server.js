require('./instrumentation');
const express = require('express');
const customerDb = require('./customerDb');
const controlPanelClient = require('./controlPanelClient');

const app = express();
app.use(express.json());

let ticketCounter = 0;

app.post('/tickets', async (req, res) => {
  const id = ++ticketCounter;
  let settings;
  try {
    settings = await controlPanelClient.getSettings();
  } catch (err) {
    console.error(`[worker] failed to reach control-plane: ${err.message}`);
    return res.status(502).json({ error: 'control-plane unreachable' });
  }

  const costSpiked = customerDb.isCostSpiked();
  const estimatedCost = (costSpiked && settings.active_model === 'gpt-standard') ? 0.85 : 0.02;

  if (settings.use_backup_data) {
    return res.json({
      ticket_id: id,
      customer: { id: req.body.customerId || 'unknown', name: 'cached-customer' },
      model: settings.active_model,
      estimated_cost_usd: estimatedCost,
      db_broken: false,
    });
  }

  try {
    const customer = await customerDb.lookupCustomer(req.body.customerId || id);
    res.json({
      ticket_id: id,
      customer,
      model: settings.active_model,
      estimated_cost_usd: estimatedCost,
      db_broken: false,
    });
  } catch (err) {
    res.status(503).json({
      ticket_id: id,
      error: err.message,
      model: settings.active_model,
      estimated_cost_usd: estimatedCost,
      db_broken: true,
    });
  }
});
app.post('/debug/break-db', (req, res) => { customerDb.breakDb(); res.send('db broken'); });
app.post('/debug/fix-db', (req, res) => { customerDb.fixDb(); res.send('db fixed'); });
app.post('/debug/spike-cost', (req, res) => { customerDb.spikeCost(); res.send('cost spiked'); });
app.post('/debug/fix-cost', (req, res) => { customerDb.fixCost(); res.send('cost fixed'); });

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`worker-service listening on port ${PORT}`));
