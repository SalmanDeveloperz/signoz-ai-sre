const axios = require('axios');

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://localhost:4001';

async function getSettings() {
  const res = await axios.get(`${CONTROL_PLANE_URL}/settings`);
  return res.data;
}

module.exports = { getSettings };