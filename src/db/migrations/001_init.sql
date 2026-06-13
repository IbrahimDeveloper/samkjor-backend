-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─────────────────────────────────────────────
-- Users
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role                   TEXT NOT NULL CHECK (role IN ('driver', 'passenger', 'both')),
  name                   TEXT NOT NULL,
  phone                  TEXT NOT NULL UNIQUE,
  phone_verified         BOOLEAN NOT NULL DEFAULT FALSE,
  rating                 NUMERIC(3,2) NOT NULL DEFAULT 5.0,
  payment_method_id      TEXT,
  driver_license_verified BOOLEAN NOT NULL DEFAULT FALSE,
  fcm_token              TEXT,
  password_hash          TEXT NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- OTP (phone verification)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone      TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT FALSE
);

-- ─────────────────────────────────────────────
-- Rides  (live rides + future shared trips)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rides (
  ride_id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_type             TEXT NOT NULL CHECK (ride_type IN ('live', 'future')),
  initiator_id          UUID NOT NULL REFERENCES users(user_id),
  origin_coords         GEOGRAPHY(Point, 4326) NOT NULL,
  destination_address   TEXT NOT NULL,
  destination_coords    GEOGRAPHY(Point, 4326) NOT NULL,
  route_polyline        GEOGRAPHY(LineString, 4326) NOT NULL,
  base_fare             INTEGER NOT NULL,        -- NOK øre
  total_seats           INTEGER NOT NULL CHECK (total_seats BETWEEN 1 AND 4),
  seats_remaining       INTEGER NOT NULL,
  scheduled_at          TIMESTAMPTZ NOT NULL,
  join_deadline         TIMESTAMPTZ,             -- future trips only
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','live','scheduled','full','completed','cancelled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS rides_route_gix      ON rides USING GIST (route_polyline);
CREATE INDEX IF NOT EXISTS rides_origin_gix     ON rides USING GIST (origin_coords);
CREATE INDEX IF NOT EXISTS rides_status_idx     ON rides (status);
CREATE INDEX IF NOT EXISTS rides_type_status    ON rides (ride_type, status);
CREATE INDEX IF NOT EXISTS rides_scheduled_idx  ON rides (scheduled_at);

-- ─────────────────────────────────────────────
-- Bookings
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  booking_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id         UUID NOT NULL REFERENCES rides(ride_id),
  passenger_id    UUID NOT NULL REFERENCES users(user_id),
  pickup_coords   GEOGRAPHY(Point, 4326) NOT NULL,
  fare_at_booking INTEGER,    -- locked split fare (live rides); NULL until settled for future trips
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','boarded','completed','cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ride_id, passenger_id)
);

CREATE INDEX IF NOT EXISTS bookings_ride_idx ON bookings (ride_id);
CREATE INDEX IF NOT EXISTS bookings_pax_idx  ON bookings (passenger_id);

-- ─────────────────────────────────────────────
-- Payments
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  payment_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id        UUID NOT NULL REFERENCES bookings(booking_id),
  user_id           UUID NOT NULL REFERENCES users(user_id),
  amount            INTEGER NOT NULL,   -- NOK øre
  currency          TEXT NOT NULL DEFAULT 'NOK',
  provider          TEXT NOT NULL CHECK (provider IN ('vipps', 'stripe')),
  provider_ref      TEXT,               -- external payment ID
  status            TEXT NOT NULL DEFAULT 'held'
                      CHECK (status IN ('held','captured','refunded','failed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS payments_booking_idx ON payments (booking_id);
CREATE INDEX IF NOT EXISTS payments_user_idx    ON payments (user_id);

-- ─────────────────────────────────────────────
-- Notifications log
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(user_id),
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fcm_result   TEXT
);
