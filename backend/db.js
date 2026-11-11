
require("dotenv").config();

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing in .env");
}

// Load the downloaded Supabase SSL certificate
const certificatePath =
  process.env.SUPABASE_CA_PATH ||
  path.join(__dirname, "supabase-ca.crt");

if (!fs.existsSync(certificatePath)) {
  throw new Error("Supabase SSL certificate not found");
}

const certificate = fs.readFileSync(
  certificatePath,
  "utf8"
);

// Parse the database URL separately to prevent
// SSL URL parameters from overriding the certificate.
const connection = new URL(process.env.DATABASE_URL);

const pool = new Pool({
  host: connection.hostname,
  port: Number(connection.port || 5432),
  database: decodeURIComponent(connection.pathname.slice(1)),
  user: decodeURIComponent(connection.username),
  password: decodeURIComponent(connection.password),
  max: 5,
  connectionTimeoutMillis: 10000,
  ssl: {
    ca: certificate,
    rejectUnauthorized: true
  }
});

module.exports = pool;
