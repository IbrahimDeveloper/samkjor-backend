import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthPayload } from "../types";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing token" });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? "dev-secret") as AuthPayload;
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireDriver(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== "driver" && req.user.role !== "both")) {
    res.status(403).json({ error: "Driver role required" });
    return;
  }
  next();
}

export function requirePassenger(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== "passenger" && req.user.role !== "both")) {
    res.status(403).json({ error: "Passenger role required" });
    return;
  }
  next();
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET ?? "dev-secret", {
    expiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  } as jwt.SignOptions);
}
