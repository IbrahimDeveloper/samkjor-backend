import { query } from "../../db";
import { redis, keys } from "../../redis";

export interface MatchInput {
  originLat: number;
  originLng: number;
  destinationLat: number;
  destinationLng: number;
}

export interface MatchResult {
  ride_id: string;
  ride_type: string;
  status: string;
  initiator_name: string;
  initiator_rating: number;
  destination_address: string;
  seats_remaining: number;
  fare_per_person: number;
  scheduled_at: string;
  direction_score: number;
  detour_metres: number;
  route_polyline_geo: object;
}

const CORRIDOR_METRES = () =>
  parseInt(process.env.MATCH_CORRIDOR_METRES ?? "800", 10);
const CACHE_TTL = () =>
  parseInt(process.env.MATCH_CACHE_TTL_SECONDS ?? "10", 10);

export async function findMatches(input: MatchInput): Promise<MatchResult[]> {
  const cacheKey = keys.matchCache(
    `${input.originLat.toFixed(4)},${input.originLng.toFixed(4)}`,
    `${input.destinationLat.toFixed(4)},${input.destinationLng.toFixed(4)}`
  );

  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached) as MatchResult[];

  // PostGIS query:
  // 1. rides whose polyline passes within CORRIDOR_METRES of passenger's straight-line route
  // 2. scored by direction overlap (lower Hausdorff distance = better direction match)
  // 3. only rides/trips with seats remaining and in bookable status
  const rows = await query<MatchResult>(
    `WITH passenger_line AS (
       SELECT ST_MakeLine(
         ST_SetSRID(ST_MakePoint($2, $1), 4326)::geometry,
         ST_SetSRID(ST_MakePoint($4, $3), 4326)::geometry
       )::geography AS geog
     )
     SELECT
       r.ride_id,
       r.ride_type,
       r.status,
       u.name AS initiator_name,
       u.rating AS initiator_rating,
       r.destination_address,
       r.seats_remaining,
       CEIL(r.base_fare::numeric / (
         SELECT COUNT(*) + 1 FROM bookings b2
         WHERE b2.ride_id = r.ride_id AND b2.status IN ('confirmed','boarded','completed')
       )) AS fare_per_person,
       r.scheduled_at,
       ST_HausdorffDistance(
         r.route_polyline::geometry,
         (SELECT geog FROM passenger_line)::geometry
       ) AS direction_score,
       ST_Distance(
         r.route_polyline,
         ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
       ) AS detour_metres,
       ST_AsGeoJSON(r.route_polyline)::json AS route_polyline_geo
     FROM rides r
     JOIN users u ON u.user_id = r.initiator_id
     CROSS JOIN passenger_line pl
     WHERE r.status IN ('live', 'scheduled')
       AND r.seats_remaining > 0
       AND ST_DWithin(r.route_polyline, pl.geog, $5)
     ORDER BY direction_score ASC, detour_metres ASC
     LIMIT 10`,
    [
      input.originLat,
      input.originLng,
      input.destinationLat,
      input.destinationLng,
      CORRIDOR_METRES(),
    ]
  );

  await redis.set(cacheKey, JSON.stringify(rows), "EX", CACHE_TTL());
  return rows;
}
