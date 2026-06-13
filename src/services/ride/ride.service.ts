import { query, queryOne } from "../../db";
import { redis, keys } from "../../redis";
import { computeBaseFare } from "../fare/fare.service";
import { notifyBookingPassengers, sendPush } from "../notification/notification.service";
import { emailDriverTripClaimed, emailPassengerDriverAssigned } from "../email/email.service";

export interface PostRideInput {
  initiatorId: string;
  rideType: "live" | "future";
  originLat: number;
  originLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  routePolyline: GeoJSON.LineString;   // from Google Directions
  totalSeats: number;
  scheduledAt?: Date;                   // required for future trips
  joinDeadline?: Date;
  distanceMetres: number;
  city?: string;
}

export interface GeoJSON {
  LineString: { type: "LineString"; coordinates: [number, number][] };
}

declare namespace GeoJSON {
  interface LineString { type: "LineString"; coordinates: [number, number][]; }
}

export async function postRide(input: PostRideInput) {
  const baseFare = computeBaseFare(input.distanceMetres, input.city ?? "oslo");
  const scheduledAt = input.scheduledAt ?? new Date();
  const status = input.rideType === "live" ? "live" : "scheduled";

  const rows = await query<{ ride_id: string }>(
    `INSERT INTO rides (
       ride_type, initiator_id,
       origin_coords, destination_address, destination_coords,
       route_polyline, base_fare, total_seats, seats_remaining,
       scheduled_at, join_deadline, status
     ) VALUES (
       $1, $2,
       ST_SetSRID(ST_MakePoint($3, $4), 4326),
       $5,
       ST_SetSRID(ST_MakePoint($6, $7), 4326),
       ST_GeomFromGeoJSON($8),
       $9, $10, $10,
       $11, $12, $13
     ) RETURNING ride_id`,
    [
      input.rideType,
      input.initiatorId,
      input.originLng, input.originLat,
      input.destinationAddress,
      input.destinationLng, input.destinationLat,
      JSON.stringify(input.routePolyline),
      baseFare,
      input.totalSeats,
      scheduledAt.toISOString(),
      input.joinDeadline?.toISOString() ?? null,
      status,
    ]
  );

  const rideId = rows[0].ride_id;

  // Cache seat count in Redis for fast reads
  await redis.set(keys.seatsRemaining(rideId), input.totalSeats);

  return getRide(rideId);
}

export async function getRide(rideId: string) {
  return queryOne<Record<string, unknown>>(
    `SELECT r.*,
            ST_AsGeoJSON(r.route_polyline)::json AS route_polyline_geo,
            ST_Y(r.origin_coords::geometry) AS origin_lat,
            ST_X(r.origin_coords::geometry) AS origin_lng,
            ST_Y(r.destination_coords::geometry) AS dest_lat,
            ST_X(r.destination_coords::geometry) AS dest_lng,
            u.name AS initiator_name, u.rating AS initiator_rating
     FROM rides r
     JOIN users u ON u.user_id = r.initiator_id
     WHERE r.ride_id = $1`,
    [rideId]
  );
}

export async function listRidesNearby(lat: number, lng: number, radiusMetres = 5000) {
  return query<Record<string, unknown>>(
    `SELECT r.ride_id, r.ride_type, r.status, r.seats_remaining,
            r.base_fare, r.scheduled_at, r.destination_address,
            ST_AsGeoJSON(r.route_polyline)::json AS route_polyline_geo,
            u.name AS initiator_name, u.rating AS initiator_rating
     FROM rides r
     JOIN users u ON u.user_id = r.initiator_id
     WHERE r.status IN ('live', 'scheduled')
       AND r.seats_remaining > 0
       AND ST_DWithin(
             r.origin_coords,
             ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
             $3
           )
     ORDER BY r.scheduled_at ASC
     LIMIT 100`,
    [lat, lng, radiusMetres]
  );
}

export async function cancelRide(rideId: string, initiatorId: string) {
  const ride = await queryOne<{ status: string; initiator_id: string }>(
    "SELECT status, initiator_id FROM rides WHERE ride_id = $1",
    [rideId]
  );
  if (!ride) throw new Error("Ride not found");
  if (ride.initiator_id !== initiatorId) throw new Error("Forbidden");
  if (["completed", "cancelled"].includes(ride.status)) {
    throw new Error("Ride already ended");
  }

  await query(
    "UPDATE rides SET status = 'cancelled', ended_at = NOW() WHERE ride_id = $1",
    [rideId]
  );

  // Cancel all pending/confirmed bookings
  await query(
    `UPDATE bookings SET status = 'cancelled'
     WHERE ride_id = $1 AND status IN ('pending','confirmed','boarded')`,
    [rideId]
  );

  await notifyBookingPassengers(rideId, {
    title: "Ride cancelled",
    body: "Your ride has been cancelled by the driver. You will be refunded in full.",
    data: { type: "ride_cancelled", rideId },
  });

  await redis.del(keys.seatsRemaining(rideId));
}

export async function endRide(rideId: string, initiatorId: string) {
  const ride = await queryOne<{ status: string; initiator_id: string }>(
    "SELECT status, initiator_id FROM rides WHERE ride_id = $1",
    [rideId]
  );
  if (!ride) throw new Error("Ride not found");
  if (ride.initiator_id !== initiatorId) throw new Error("Forbidden");
  if (ride.status !== "live") throw new Error("Ride is not live");

  await query(
    `UPDATE rides SET status = 'completed', ended_at = NOW() WHERE ride_id = $1`,
    [rideId]
  );
  await query(
    `UPDATE bookings SET status = 'completed'
     WHERE ride_id = $1 AND status IN ('confirmed', 'boarded')`,
    [rideId]
  );

  await redis.del(keys.seatsRemaining(rideId));
  return getRide(rideId);
}

export async function claimTrip(rideId: string, driverId: string) {
  const ride = await queryOne<{ status: string; ride_type: string; assigned_driver_id: string | null }>(
    "SELECT status, ride_type, assigned_driver_id FROM rides WHERE ride_id = $1",
    [rideId]
  );
  if (!ride) throw new Error("Ride not found");
  if (ride.ride_type !== "future") throw new Error("Only future trips can be claimed");
  if (ride.status !== "scheduled") throw new Error("Trip is not available to claim");
  if (ride.assigned_driver_id) throw new Error("Trip already has a driver");

  const driver = await queryOne<{ name: string; phone: string; rating: number }>(
    "SELECT name, phone, rating FROM users WHERE user_id = $1",
    [driverId]
  );
  if (!driver) throw new Error("Driver not found");

  await query(
    "UPDATE rides SET assigned_driver_id = $1 WHERE ride_id = $2",
    [driverId, rideId]
  );

  // Notify every confirmed passenger on this trip
  const passengers = await query<{ passenger_id: string }>(
    `SELECT passenger_id FROM bookings
     WHERE ride_id = $1 AND status IN ('confirmed', 'pending')`,
    [rideId]
  );

  await Promise.all([
    ...passengers.map((p) =>
      sendPush(p.passenger_id, {
        title: "Your driver is confirmed!",
        body: `${driver.name} (★ ${Number(driver.rating).toFixed(1)}) will be your driver. Get ready!`,
        data: { type: "driver_assigned", rideId, driverId, driverName: driver.name },
      })
    ),
    emailDriverTripClaimed(driverId, rideId),
    ...passengers.map((p) => emailPassengerDriverAssigned(p.passenger_id, driverId, rideId)),
  ]);

  return getRide(rideId);
}

export async function updateDriverLocation(
  rideId: string,
  lat: number,
  lng: number
): Promise<void> {
  await redis.set(
    keys.driverLocation(rideId),
    JSON.stringify({ lat, lng, ts: Date.now() }),
    "EX",
    30
  );
}
