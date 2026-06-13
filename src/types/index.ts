export type RideType = "live" | "future";

export type RideStatus =
  | "draft"
  | "live"
  | "scheduled"
  | "full"
  | "completed"
  | "cancelled";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "boarded"
  | "completed"
  | "cancelled";

export type UserRole = "driver" | "passenger" | "both";

export interface Coords {
  lat: number;
  lng: number;
}

export interface Ride {
  ride_id: string;
  ride_type: RideType;
  initiator_id: string;
  origin_coords: Coords;
  destination_address: string;
  destination_coords: Coords;
  route_polyline: GeoJSON.LineString;
  base_fare: number; // NOK øre
  total_seats: number;
  seats_remaining: number;
  scheduled_at: Date;
  status: RideStatus;
  created_at: Date;
  ended_at: Date | null;
}

export interface Booking {
  booking_id: string;
  ride_id: string;
  passenger_id: string;
  pickup_coords: Coords;
  fare_at_booking: number | null;
  status: BookingStatus;
  created_at: Date;
}

export interface User {
  user_id: string;
  role: UserRole;
  name: string;
  phone: string;
  rating: number;
  payment_method_id: string | null;
  driver_license_verified: boolean;
  fcm_token: string | null;
  created_at: Date;
}

export interface AuthPayload {
  user_id: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// GeoJSON minimal types (avoids a heavy dependency)
declare namespace GeoJSON {
  interface LineString {
    type: "LineString";
    coordinates: [number, number][];
  }
  interface Point {
    type: "Point";
    coordinates: [number, number];
  }
}
