// db/index.js
// Drizzle ORM client instance, backed by a mysql2 connection pool.
// Use this (`const { db } = require('./db')`) for any new/refactored queries built with Drizzle.
// The existing raw mysql2 pool in config/db.config.js is untouched and still powers the
// current controllers.

const mysql = require('mysql2/promise');
const { drizzle } = require('drizzle-orm/mysql2');
require('dotenv').config();

const schema = require('./schema');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'roi_tracking_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

const db = drizzle(pool, { schema, mode: 'default' });

module.exports = { db, pool, schema };
