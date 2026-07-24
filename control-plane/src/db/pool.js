// Pattern: Singleton.
// One Pool instance shared by every repository in this process.
// A second Pool would open its own connection set against Postgres,
// wasting connections for no benefit since pg.Pool already pools internally.

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

module.exports = pool;
