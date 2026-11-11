
const pool = require("./db");

async function testConnection() {
  try {
    const result = await pool.query(
      "SELECT NOW() AS server_time"
    );

    console.log("Database connected successfully!");
    console.log("Server time:", result.rows[0].server_time);

    const users = await pool.query(
      "SELECT name, email FROM public.users"
    );

    console.log("Demo users:", users.rows);
  } catch (error) {
    console.error("Connection failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

testConnection();
