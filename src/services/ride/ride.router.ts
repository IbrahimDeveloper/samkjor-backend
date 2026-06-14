import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth, requireDriver } from "../../middleware/auth";
import { queryOne } from "../../db";
import {
  postRide,
  getRide,
  listRidesNearby,
  cancelRide,
  endRide,
  updateDriverLocation,
  claimTrip,
  startTrip,
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
  pickup_address: z.string().optional(),
  pickup_lat: z.number().optional(),
  pickup_lng: z.number().optional(),
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
      pickupAddress: body.pickup_address,
      pickupLat: body.pickup_lat,
      pickupLng: body.pickup_lng,
    });

    res.status(201).json(ride);
  } catch (err) {
    next(err);
  }
});

// GET /rides/my-active  — driver's current live ride
router.get("/my-active", requireAuth, requireDriver, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ride = await queryOne<Record<string, unknown>>(
      `SELECT r.*,
              ST_AsGeoJSON(r.route_polyline)::json AS route_polyline_geo,
              ST_Y(r.origin_coords::geometry) AS origin_lat,
              ST_X(r.origin_coords::geometry) AS origin_lng,
              ST_Y(r.destination_coords::geometry) AS dest_lat,
              ST_X(r.destination_coords::geometry) AS dest_lng
       FROM rides r
       WHERE r.initiator_id = $1 AND r.status IN ('live','scheduled')
       ORDER BY r.created_at DESC LIMIT 1`,
      [req.user!.user_id]
    );
    res.json(ride ?? null);
  } catch (err) { next(err); }
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

// GET /rides/my-trip — passenger's active organized trip (as organizer or member)
router.get("/my-trip", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ride = await queryOne<Record<string, unknown>>(
      `SELECT r.*,
              ST_AsGeoJSON(r.route_polyline)::json AS route_polyline_geo,
              ST_Y(r.origin_coords::geometry) AS origin_lat,
              ST_X(r.origin_coords::geometry) AS origin_lng,
              ST_Y(r.destination_coords::geometry) AS dest_lat,
              ST_X(r.destination_coords::geometry) AS dest_lng,
              CASE WHEN r.pickup_coords IS NOT NULL THEN ST_Y(r.pickup_coords::geometry) END AS pickup_lat,
              CASE WHEN r.pickup_coords IS NOT NULL THEN ST_X(r.pickup_coords::geometry) END AS pickup_lng,
              u.name AS initiator_name
       FROM rides r
       JOIN users u ON u.user_id = r.initiator_id
       WHERE r.ride_type = 'future'
         AND r.status IN ('scheduled','live')
         AND (
           r.initiator_id = $1
           OR EXISTS (
             SELECT 1 FROM bookings b
             WHERE b.ride_id = r.ride_id
               AND b.passenger_id = $1
               AND b.status IN ('pending','confirmed')
           )
         )
       ORDER BY r.created_at DESC LIMIT 1`,
      [req.user!.user_id]
    );
    res.json(ride ?? null);
  } catch (err) { next(err); }
});

// POST /rides/:id/start  — organizer starts the trip
router.post("/:id/start", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ride = await startTrip(req.params.id, req.user!.user_id);
    res.json(ride);
  } catch (err) { next(err); }
});

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
