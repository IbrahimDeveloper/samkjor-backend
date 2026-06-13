import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { holdPayment, capturePayments, refundPayment } from "./payment.service";

const router = Router();

// POST /payments/hold  — initiate payment hold for a booking
router.post("/hold", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { booking_id } = z.object({ booking_id: z.string().uuid() }).parse(req.body);
    const result = await holdPayment(booking_id);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /payments/capture/:rideId  — driver triggers capture after End Ride
router.post("/capture/:rideId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await capturePayments(req.params.rideId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /payments/refund  — refund a booking
router.post("/refund", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { booking_id } = z.object({ booking_id: z.string().uuid() }).parse(req.body);
    await refundPayment(booking_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /payments/vipps/callback  — Vipps webhook
router.post("/vipps/callback", async (req: Request, res: Response) => {
  // In production: verify Vipps signature, update payment status
  console.log("Vipps callback:", JSON.stringify(req.body));
  res.sendStatus(200);
});

export default router;
