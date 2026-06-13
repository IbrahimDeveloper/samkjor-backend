import { query, queryOne } from "../../db";

// City rates in NOK øre per metre
const CITY_RATES: Record<string, number> = {
  oslo: 22,    // ~22 øre/m → 22 kr/km
  default: 20,
};

export function computeBaseFare(distanceMetres: number, city = "oslo"): number {
  const rate = CITY_RATES[city.toLowerCase()] ?? CITY_RATES.default;
  return Math.round(distanceMetres * rate);
}

export function splitFare(baseFare: number, totalRiders: number): number {
  return Math.ceil(baseFare / totalRiders);
}

export async function recalculateSplit(rideId: string): Promise<number> {
  const row = await queryOne<{ base_fare: number; confirmed: string }>(
    `SELECT r.base_fare,
            (COUNT(b.booking_id) + 1)::text AS confirmed   -- +1 for first customer
     FROM rides r
     LEFT JOIN bookings b ON b.ride_id = r.ride_id
       AND b.status IN ('confirmed', 'boarded', 'completed')
     WHERE r.ride_id = $1
     GROUP BY r.base_fare`,
    [rideId]
  );
  if (!row) throw new Error(`Ride ${rideId} not found`);
  return splitFare(row.base_fare, parseInt(row.confirmed, 10));
}

export async function getFareSummary(rideId: string) {
  const row = await queryOne<{
    base_fare: number;
    confirmed_riders: string;
    fare_per_person: number;
  }>(
    `SELECT r.base_fare,
            (COUNT(b.booking_id) + 1)::text AS confirmed_riders,
            CEIL(r.base_fare::numeric / (COUNT(b.booking_id) + 1)) AS fare_per_person
     FROM rides r
     LEFT JOIN bookings b ON b.ride_id = r.ride_id
       AND b.status IN ('confirmed', 'boarded', 'completed')
     WHERE r.ride_id = $1
     GROUP BY r.base_fare`,
    [rideId]
  );
  return row;
}

// Update fare_at_booking for all current confirmed bookings on a ride
export async function updateAllBookingFares(rideId: string): Promise<void> {
  await query(
    `UPDATE bookings
     SET fare_at_booking = (
       SELECT CEIL(r.base_fare::numeric / (
         SELECT COUNT(*) + 1
         FROM bookings b2
         WHERE b2.ride_id = r.ride_id
           AND b2.status IN ('confirmed', 'boarded', 'completed')
       ))
       FROM rides r WHERE r.ride_id = bookings.ride_id
     )
     WHERE ride_id = $1
       AND status IN ('confirmed', 'boarded')`,
    [rideId]
  );
}
