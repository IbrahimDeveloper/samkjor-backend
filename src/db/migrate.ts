import { pool } from "./index";
import fs from "fs";
import path from "path";

async function migrate() {
  const files = ["001_init.sql", "002_claim_and_address.sql"];
  const sql = files
    .map((f) => fs.readFileSync(path.join(__dirname, "migrations", f), "utf8"))
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
