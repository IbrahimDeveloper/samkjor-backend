-- Driver assigned to a future trip after claiming it
ALTER TABLE rides ADD COLUMN IF NOT EXISTS assigned_driver_id UUID REFERENCES users(user_id);

-- Human-readable pickup address supplied by the passenger at booking time
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_address TEXT;
