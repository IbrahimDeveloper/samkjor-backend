import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireDriver } from "../../middleware/auth";
import {
  postRide,
  getRide,
  listRidesNearby,
  cancelRide,
  endRide,
  updateDriverLocation,
  claimTrip,
} from "./ride.service";

const router = Router();

const PostRideSchema = z.object({
  ride_type: z.enum(["live", "future"]),
  origin_lat: z.number(),
  origin_lng: z.number(),
  destination_address: z.string().min(2),
  destination_lat: z.number(),
  destination_lng: z.number(),
  route_polyline: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
  total_seats: z.number().int().min(1).max(4),
  scheduled_at: z.string().datetime().optional(),
  join_deadline: z.string().datetime().optional(),
  distance_metres: z.number().positive(),
  city: z.string().optional(),
});

// POST /rides — driver or passenger organiser posts a ride/trip
router.post("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = PostRideSchema.parse(req.body);

    if (body.ride_type === "future" && !body.scheduled_at) {
      res.status(400).json({ error: "scheduled_at is required for future trips" });
      return;
    }

    const ride = await postRide({
      initiatorId: req.user!.user_id,
      rideType: body.ride_type,
      originLat: body.origin_lat,
      originLng: body.origin_lng,
      destinationAddress: body.destination_address,
      destinationLat: body.destination_lat,
      destinationLng: body.destination_lng,
      routePolyline: body.route_polyline,
      totalSeats: body.total_seats,
      scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : undefined,
      joinDeadline: body.join_deadline ? new Date(body.join_deadline) : undefined,
      distanceMetres: body.distance_metres,
      city: body.city,
    });

    res.status(201).json(ride);
  } catch (err) {
    next(err);
  }
});

// GET /rides/nearby?lat=&lng=&radius=
router.get("/nearby", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const radius = Number(req.query.radius ?? 5000);
    if (!lat || !lng) {
      res.status(400).json({ error: "lat and lng are required" });
      return;
    }
    const rides = await listRidesNearby(lat, lng, radius);
    res.json(rides);
  } catch (err) {
    next(err);
  }
});

// GET /rides/:id
router.get("/:id", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ride = await getRide(req.params.id);
    if (!ride) { res.status(404).json({ error: "Not found" }); return; }
    res.json(ride);
  } catch (err) { next(err); }
});

// POST /rides/:id/location — driver GPS update (called every 3s from driver app)
router.post(
  "/:id/location",
  requireAuth,
  requireDriver,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { lat, lng } = z.object({ lat: z.number(), lng: z.number() }).parse(req.body);
      await updateDriverLocation(req.params.id, lat, lng);
      res.json({ ok: true });
    } catch (err) { next(err); }
  }
);

// POST /rides/:id/claim  — driver takes a future passenger trip
router.post("/:id/claim", requireAuth, requireDriver, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ride = await claimTrip(req.params.id, req.user!.user_id);
    res.json(ride);
  } catch (err) { next(err); }
});

// POST /rides/:id/cancel
router.post("/:id/cancel", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await cancelRide(req.params.id, req.user!.user_id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /rides/:id/end
router.post("/:id/end", requireAuth, requireDriver, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ride = await endRide(req.params.id, req.user!.user_id);
    res.json(ride);
  } catch (err) { next(err); }
});

export default router;
