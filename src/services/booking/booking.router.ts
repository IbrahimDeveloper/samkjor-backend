import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireDriver } from "../../middleware/auth";
import { bookSeat, getBooking, listRideBookings, cancelBooking, acceptBooking, declineBooking } from "./booking.service";

const router = Router();

const BookSchema = z.object({
  ride_id: z.string().uuid(),
  pickup_lat: z.number(),
  pickup_lng: z.number(),
  pickup_address: z.string().min(2),
});

// POST /bookings
router.post("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = BookSchema.parse(req.body);
    const booking = await bookSeat({
      rideId: body.ride_id,
      passengerId: req.user!.user_id,
      pickupLat: body.pickup_lat,
      pickupLng: body.pickup_lng,
      pickupAddress: body.pickup_address,
    });
    res.status(201).json(booking);
  } catch (err) { next(err); }
});

// GET /bookings/:id
router.get("/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const booking = await getBooking(req.params.id);
    if (!booking) { res.status(404).json({ error: "Not found" }); return; }
    res.json(booking);
  } catch (err) { next(err); }
});

// GET /bookings/ride/:rideId  — list all bookings for a ride (driver view)
router.get("/ride/:rideId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bookings = await listRideBookings(req.params.rideId);
    res.json(bookings);
  } catch (err) { next(err); }
});

// POST /bookings/:id/cancel
router.post("/:id/cancel", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await cancelBooking(req.params.id, req.user!.user_id);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /bookings/:id/accept  — driver accepts a pending booking
router.post("/:id/accept", requireAuth, requireDriver, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await acceptBooking(req.params.id, req.user!.user_id);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /bookings/:id/decline  — driver declines a pending booking
router.post("/:id/decline", requireAuth, requireDriver, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await declineBooking(req.params.id, req.user!.user_id);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
