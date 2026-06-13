import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { query, queryOne } from "../../db";
import { signToken, requireAuth } from "../../middleware/auth";

const router = Router();

const RegisterSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(8),
  password: z.string().min(6),
  role: z.enum(["driver", "passenger", "both"]),
});

const LoginSchema = z.object({
  phone: z.string(),
  password: z.string(),
});

// POST /auth/register
router.post("/register", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RegisterSchema.parse(req.body);
    const exists = await queryOne("SELECT user_id FROM users WHERE phone = $1", [body.phone]);
    if (exists) { res.status(409).json({ error: "Phone already registered" }); return; }

    const hash = await bcrypt.hash(body.password, 10);
    const rows = await query<{ user_id: string; role: string }>(
      `INSERT INTO users (name, phone, role, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING user_id, role`,
      [body.name, body.phone, body.role, hash]
    );
    const user = rows[0];
    const token = signToken({ user_id: user.user_id, role: user.role as "driver" | "passenger" | "both" });
    res.status(201).json({ token, user_id: user.user_id, role: user.role });
  } catch (err) { next(err); }
});

// POST /auth/login
router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = LoginSchema.parse(req.body);
    const user = await queryOne<{ user_id: string; role: string; password_hash: string }>(
      "SELECT user_id, role, password_hash FROM users WHERE phone = $1",
      [body.phone]
    );
    if (!user) { res.status(401).json({ error: "Invalid credentials" }); return; }

    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) { res.status(401).json({ error: "Invalid credentials" }); return; }

    const token = signToken({ user_id: user.user_id, role: user.role as "driver" | "passenger" | "both" });
    res.json({ token, user_id: user.user_id, role: user.role });
  } catch (err) { next(err); }
});

// GET /auth/me
router.get("/me", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await queryOne(
      `SELECT user_id, name, phone, role, rating, driver_license_verified, created_at
       FROM users WHERE user_id = $1`,
      [req.user!.user_id]
    );
    if (!user) { res.status(404).json({ error: "Not found" }); return; }
    res.json(user);
  } catch (err) { next(err); }
});

// PATCH /auth/fcm  — save device FCM token
router.patch("/fcm", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = z.object({ token: z.string() }).parse(req.body);
    await query("UPDATE users SET fcm_token = $1 WHERE user_id = $2", [token, req.user!.user_id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
