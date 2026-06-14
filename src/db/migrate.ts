import { Pool } from "pg";
import "dotenv/config";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
import fs from "fs";
import path from "path";

async function migrate() {
  // Look for migrations next to the source file, not in dist/
  const migrationsDir = path.resolve(__dirname, "..", "..", "src", "db", "migrations");
  // Fallback to relative path when running from src directly (local dev)
  const dir = fs.existsSync(migrationsDir)
    ? migrationsDir
    : path.join(__dirname, "migrations");

  const files = ["001_init.sql", "002_claim_and_address.sql", "003_add_email.sql", "004_group_trip.sql"];
  const sql = files
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log("Migration complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
