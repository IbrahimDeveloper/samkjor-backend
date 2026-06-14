-- Group pickup point on rides (for organized passenger trips)
ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS pickup_coords  GEOGRAPHY(Point, 4326);

-- Track payment hold status per booking
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_held BOOLEAN NOT NULL DEFAULT FALSE;
