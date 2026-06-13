import { Server as HttpServer } from "http";
import { Server as SocketServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { redis, keys } from "../../redis";
import { AuthPayload } from "../../types";

let io: SocketServer;

export function initRealtime(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
  });

  // Authenticate every socket connection
  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    if (!token) { next(new Error("Authentication required")); return; }
    try {
      const payload = jwt.verify(
        token,
        process.env.JWT_SECRET ?? "dev-secret"
      ) as AuthPayload;
      (socket as SocketWithUser).user = payload;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const user = (socket as SocketWithUser).user;

    // ── Subscribe to a ride channel (passenger or driver)
    socket.on("join:ride", (rideId: string) => {
      socket.join(`ride:${rideId}`);
    });

    socket.on("leave:ride", (rideId: string) => {
      socket.leave(`ride:${rideId}`);
    });

    // ── Driver broadcasts location every 3 s
    socket.on(
      "driver:location",
      async (data: { ride_id: string; lat: number; lng: number }) => {
        if (!data.ride_id || !data.lat || !data.lng) return;
        const payload = { lat: data.lat, lng: data.lng, ts: Date.now() };
        await redis.set(
          keys.driverLocation(data.ride_id),
          JSON.stringify(payload),
          "EX",
          30
        );
        // Broadcast to all subscribers of this ride
        io.to(`ride:${data.ride_id}`).emit("driver:location", {
          ride_id: data.ride_id,
          ...payload,
        });
      }
    );

    // ── Subscribe to a geographic area (home screen map)
    socket.on("join:area", (geohash: string) => {
      socket.join(`area:${geohash}`);
    });
  });

  return io;
}

export function getIO(): SocketServer {
  if (!io) throw new Error("Socket.IO not initialised");
  return io;
}

// Called by ride/booking services to push events to relevant clients
export function emitToRide(rideId: string, event: string, data: unknown) {
  getIO().to(`ride:${rideId}`).emit(event, data);
}

export function emitToArea(geohash: string, event: string, data: unknown) {
  getIO().to(`area:${geohash}`).emit(event, data);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SocketWithUser extends Socket {
  user: AuthPayload;
}
