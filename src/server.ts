import "dotenv/config";
import http from "http";
import { createApp } from "./app";
import { initRealtime } from "./services/realtime/realtime.service";
import { pool } from "./db";
import { redis } from "./redis";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function start() {
  // Verify DB connection
  try {
    await pool.query("SELECT 1");
    console.log("PostgreSQL connected");
  } catch (err) {
    console.error("Cannot connect to PostgreSQL:", err);
    process.exit(1);
  }

  // Verify Redis connection
  try {
    await redis.ping();
    console.log("Redis connected");
  } catch (err) {
    console.error("Cannot connect to Redis:", err);
    process.exit(1);
  }

  const app = createApp();
  const httpServer = http.createServer(app);
  initRealtime(httpServer);

  httpServer.listen(PORT, () => {
    console.log(`SamKjør API listening on http://localhost:${PORT}`);
    console.log(`WebSocket available on ws://localhost:${PORT}`);
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down...");
    httpServer.close();
    await pool.end();
    redis.disconnect();
    process.exit(0);
  });
}

start();
