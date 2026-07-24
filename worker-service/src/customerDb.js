let broken = false;
let costSpiked = false;

function breakDb() { broken = true; }
function fixDb() { broken = false; }
function spikeCost() { costSpiked = true; }
function fixCost() { costSpiked = false; }

async function lookupCustomer(id) {
  if (broken) {
    const err = new Error('customer db unreachable');
    err.dbBroken = true;
    throw err;
  }
  return { id, name: 'Test Customer' };
}

function isCostSpiked() {
  return costSpiked;
}

module.exports = { breakDb, fixDb, spikeCost, fixCost, lookupCustomer, isCostSpiked };