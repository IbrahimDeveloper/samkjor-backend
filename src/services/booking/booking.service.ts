import { query, queryOne } from "../../db";
import { redis, keys } from "../../redis";
import { updateAllBookingFares } from "../fare/fare.service";
import {
  notifyBookingPassengers,
  notifyRideInitiator,
  sendPush,
} from "../notification/notification.service";
import { emailNewPassengerJoined, emailBookingAccepted } from "../email/email.service";

export interface BookSeatInput {
  rideId: string;
  passengerId: string;
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
}

export async function bookSeat(input: BookSeatInput) {
  // Verify ride is bookable in DB
  const ride = await queryOne<{
    status: string;
    seats_remaining: number;
    ride_type: string;
    base_fare: number;
  }>(
    "SELECT status, seats_remaining, ride_type, base_fare FROM rides WHERE ride_id = $1",
    [input.rideId]
  );
  if (!ride) { await redis.incr(keys.seatsRemaining(input.rideId)); throw new Error("Ride not found"); }
  if (!["live", "scheduled"].includes(ride.status)) {
    await redis.incr(keys.seatsRemaining(input.rideId));
    throw new Error("Ride is not accepting bookings");
  }

  // Create booking
  const rows = await query<{ booking_id: string }>(
    `INSERT INTO bookings (ride_id, passenger_id, pickup_coords, pickup_address, status)
     VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326), $5, 'pending')
     RETURNING booking_id`,
    [input.rideId, input.passengerId, input.pickupLng, input.pickupLat, input.pickupAddress]
  );
  const bookingId = rows[0].booking_id;

  // Notify driver of pending request — seat is NOT decremented until driver accepts
  await notifyRideInitiator(input.rideId, {
    title: "New booking request",
    body: "A passenger wants to join your ride. Open the app to accept.",
    data: { type: "booking_request", rideId: input.rideId, bookingId },
  });

  return getBooking(bookingId);
}

export async function getBooking(bookingId: string) {
  return queryOne<Record<string, unknown>>(
    `SELECT b.*,
            b.pickup_address,
            ST_Y(b.pickup_coords::geometry) AS pickup_lat,
            ST_X(b.pickup_coords::geometry) AS pickup_lng
     FROM bookings b WHERE b.booking_id = $1`,
    [bookingId]
  );
}

export async function listRideBookings(rideId: string) {
  return query<Record<string, unknown>>(
    `SELECT b.*,
            b.pickup_address,
            ST_Y(b.pickup_coords::geometry) AS pickup_lat,
            ST_X(b.pickup_coords::geometry) AS pickup_lng,
            u.name, u.phone, u.rating
     FROM bookings b
     JOIN users u ON u.user_id = b.passenger_id
     WHERE b.ride_id = $1
     ORDER BY b.created_at`,
    [rideId]
  );
}

export async function cancelBooking(bookingId: string, passengerId: string) {
  const booking = await queryOne<{
    ride_id: string;
    passenger_id: string;
    status: string;
    created_at: Date;
    fare_at_booking: number | null;
  }>(
    "SELECT ride_id, passenger_id, status, created_at, fare_at_booking FROM bookings WHERE booking_id = $1",
    [bookingId]
  );
  if (!booking) throw new Error("Booking not found");
  if (booking.passenger_id !== passengerId) throw new Error("Forbidden");
  if (["completed", "cancelled"].includes(booking.status)) {
    throw new Error("Booking already ended");
  }

  // Determine cancellation fee: 50% if <5 min from pickup for live rides
  const minutesUntilPickup =
    (new Date(booking.created_at).getTime() - Date.now()) / 60000;
  const lateCancellation = minutesUntilPickup < 5;

  await query(
    "UPDATE bookings SET status = 'cancelled' WHERE booking_id = $1",
    [bookingId]
  );

  // Re-open seat
  await query(
    `UPDATE rides
     SET seats_remaining = seats_remaining + 1,
         status = CASE WHEN status = 'full' THEN 'live' ELSE status END
     WHERE ride_id = $1`,
    [booking.ride_id]
  );
  await redis.incr(keys.seatsRemaining(booking.ride_id));

  // Recalculate fares for remaining passengers
  await updateAllBookingFares(booking.ride_id);

  await notifyRideInitiator(booking.ride_id, {
    title: "Passenger cancelled",
    body: "A passenger has cancelled their seat.",
    data: { type: "booking_cancelled", bookingId },
  });

  return { cancelled: true, late_cancellation: lateCancellation };
}

export async function acceptBooking(bookingId: string, driverId: string) {
  const booking = await queryOne<{ ride_id: string; status: string; passenger_id: string }>(
    `SELECT b.ride_id, b.status, b.passenger_id
     FROM bookings b
     JOIN rides r ON r.ride_id = b.ride_id
     WHERE b.booking_id = $1 AND r.initiator_id = $2`,
    [bookingId, driverId]
  );
  if (!booking) throw new Error("Booking not found or not your ride");
  if (booking.status !== "pending") throw new Error("Booking is not pending");

  // Check there is still a seat
  const ride = await queryOne<{ seats_remaining: number }>(
    "SELECT seats_remaining FROM rides WHERE ride_id = $1",
    [booking.ride_id]
  );
  if (!ride || ride.seats_remaining <= 0) throw new Error("No seats remaining");

  await query("UPDATE bookings SET status = 'confirmed' WHERE booking_id = $1", [bookingId]);

  // Decrement seat now
  await query(
    `UPDATE rides
     SET seats_remaining = seats_remaining - 1,
         status = CASE WHEN seats_remaining - 1 = 0 THEN 'full' ELSE status END
     WHERE ride_id = $1`,
    [booking.ride_id]
  );
  await redis.decr(keys.seatsRemaining(booking.ride_id));

  await updateAllBookingFares(booking.ride_id);

  await Promise.all([
    sendPush(booking.passenger_id, {
      title: "Booking accepted!",
      body: "The driver has accepted your request. Get ready for pickup.",
      data: { type: "booking_accepted", bookingId },
    }),
    emailBookingAccepted(bookingId),
    emailNewPassengerJoined(booking.ride_id, booking.passenger_id),
  ]);

  return getBooking(bookingId);
}

export async function declineBooking(bookingId: string, driverId: string) {
  const booking = await queryOne<{ ride_id: string; status: string; passenger_id: string }>(
    `SELECT b.ride_id, b.status, b.passenger_id
     FROM bookings b
     JOIN rides r ON r.ride_id = b.ride_id
     WHERE b.booking_id = $1 AND r.initiator_id = $2`,
    [bookingId, driverId]
  );
  if (!booking) throw new Error("Booking not found or not your ride");
  if (booking.status !== "pending") throw new Error("Booking is not pending");

  await query("UPDATE bookings SET status = 'cancelled' WHERE booking_id = $1", [bookingId]);

  await sendPush(booking.passenger_id, {
    title: "Booking declined",
    body: "The driver could not accept your request. Try another ride.",
    data: { type: "booking_declined", bookingId },
  });

  return { declined: true };
}
