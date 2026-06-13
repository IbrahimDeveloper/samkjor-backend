import Redis from "ioredis";
import dotenv from "dotenv";

dotenv.config();

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
export const redis = new Redis(redisUrl, {
  tls: redisUrl.startsWith("rediss://") ? {} : undefined,
});

redis.on("error", (err) => {
  console.error("Redis error:", err);
});

// Key helpers
export const keys = {
  driverLocation: (rideId: string) => `loc:${rideId}`,
  seatsRemaining: (rideId: string) => `seats:${rideId}`,
  matchCache: (origin: string, dest: string) => `match:${origin}:${dest}`,
  rideChannel: (rideId: string) => `ride:${rideId}`,
  corridorChannel: (geohash: string) => `corridor:${geohash}`,
};
