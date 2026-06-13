import { Resend } from "resend";
import { query, queryOne } from "../../db";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM ?? "SamKjør <onboarding@resend.dev>";

async function send(to: string, subject: string, html: string) {
  if (!resend) return;
  try {
    await resend.emails.send({ from: FROM, to, subject, html });
  } catch (err) {
    console.error("Email send failed:", err);
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

function base(body: string) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#1a1a2e;margin-bottom:4px">SamKjør</h2>
      <hr style="border:none;border-top:1px solid #eee;margin-bottom:24px"/>
      ${body}
      <hr style="border:none;border-top:1px solid #eee;margin-top:32px"/>
      <p style="color:#aaa;font-size:12px">SamKjør — Shared taxi platform</p>
    </div>`;
}

// ── Email events ──────────────────────────────────────────────────────────────

export async function emailDriverTripClaimed(driverId: string, rideId: string) {
  const driver = await queryOne<{ email: string | null; name: string }>(
    "SELECT email, name FROM users WHERE user_id = $1", [driverId]
  );
  if (!driver?.email) return;

  const ride = await queryOne<{ destination_address: string }>(
    "SELECT destination_address FROM rides WHERE ride_id = $1", [rideId]
  );
  const passengers = await query<{ name: string; pickup_address: string | null }>(
    `SELECT u.name, b.pickup_address
     FROM bookings b JOIN users u ON u.user_id = b.passenger_id
     WHERE b.ride_id = $1 AND b.status IN ('pending','confirmed')`, [rideId]
  );

  const passengerRows = passengers.length
    ? passengers.map(p =>
        `<tr>
          <td style="padding:8px 0;border-bottom:1px solid #eee">${p.name}</td>
          <td style="padding:8px 0;border-bottom:1px solid #eee;color:#555">${p.pickup_address ?? "Not specified"}</td>
        </tr>`).join("")
    : `<tr><td colspan="2" style="color:#aaa;padding:8px 0">No passengers yet</td></tr>`;

  await send(driver.email, `You claimed a trip to ${ride?.destination_address}`, base(`
    <p>Hi ${driver.name},</p>
    <p>You have successfully claimed a trip to <strong>${ride?.destination_address}</strong>.</p>
    <h3 style="color:#1a1a2e">Passengers</h3>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="text-align:left;padding-bottom:8px;color:#888;font-size:13px">Name</th>
          <th style="text-align:left;padding-bottom:8px;color:#888;font-size:13px">Pickup address</th>
        </tr>
      </thead>
      <tbody>${passengerRows}</tbody>
    </table>
  `));
}

export async function emailPassengerDriverAssigned(passengerId: string, driverId: string, rideId: string) {
  const passenger = await queryOne<{ email: string | null; name: string }>(
    "SELECT email, name FROM users WHERE user_id = $1", [passengerId]
  );
  if (!passenger?.email) return;

  const driver = await queryOne<{ name: string; rating: number; phone: string }>(
    "SELECT name, rating, phone FROM users WHERE user_id = $1", [driverId]
  );
  const ride = await queryOne<{ destination_address: string; scheduled_at: string }>(
    "SELECT destination_address, scheduled_at FROM rides WHERE ride_id = $1", [rideId]
  );

  await send(passenger.email, "Your driver has been confirmed!", base(`
    <p>Hi ${passenger.name},</p>
    <p>Great news — a driver has been assigned to your trip to <strong>${ride?.destination_address}</strong>.</p>
    <div style="background:#f0faf6;border-radius:12px;padding:16px;margin:16px 0">
      <p style="margin:0 0 8px 0"><strong>Driver:</strong> ${driver?.name}</p>
      <p style="margin:0 0 8px 0"><strong>Rating:</strong> ★ ${Number(driver?.rating).toFixed(1)}</p>
      <p style="margin:0 0 8px 0"><strong>Phone:</strong> ${driver?.phone}</p>
      <p style="margin:0"><strong>Departure:</strong> ${ride?.scheduled_at ? new Date(ride.scheduled_at).toLocaleString("no-NO") : "Now"}</p>
    </div>
    <p>Get ready at your pickup point!</p>
  `));
}

export async function emailNewPassengerJoined(rideId: string, newPassengerId: string) {
  const newPassenger = await queryOne<{ name: string; pickup_address: string | null }>(
    `SELECT u.name, b.pickup_address
     FROM bookings b JOIN users u ON u.user_id = b.passenger_id
     WHERE b.ride_id = $1 AND b.passenger_id = $2`, [rideId, newPassengerId]
  );

  const ride = await queryOne<{ destination_address: string; initiator_id: string }>(
    "SELECT destination_address, initiator_id FROM rides WHERE ride_id = $1", [rideId]
  );
  if (!ride) return;

  // All confirmed passengers + driver on this ride
  const everyone = await query<{ email: string | null; name: string; user_id: string }>(
    `SELECT DISTINCT u.email, u.name, u.user_id
     FROM users u
     WHERE u.user_id = $1                          -- driver/organiser
        OR u.user_id IN (
          SELECT passenger_id FROM bookings
          WHERE ride_id = $2 AND status IN ('pending','confirmed')
        )`, [ride.initiator_id, rideId]
  );

  const totalPassengers = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM bookings
     WHERE ride_id = $1 AND status IN ('pending','confirmed')`, [rideId]
  );

  for (const person of everyone) {
    if (!person.email) continue;
    const isDriver = person.user_id === ride.initiator_id;

    const html = isDriver
      ? base(`
          <p>Hi ${person.name},</p>
          <p><strong>${newPassenger?.name}</strong> has joined your trip to <strong>${ride.destination_address}</strong>.</p>
          <div style="background:#f5f5f5;border-radius:12px;padding:16px;margin:16px 0">
            <p style="margin:0 0 4px 0"><strong>Pickup address:</strong></p>
            <p style="margin:0;color:#555">${newPassenger?.pickup_address ?? "Not specified"}</p>
          </div>
          <p style="color:#555">Total passengers: <strong>${totalPassengers?.count ?? "?"}</strong></p>
        `)
      : base(`
          <p>Hi ${person.name},</p>
          <p><strong>${newPassenger?.name}</strong> has also joined the trip to <strong>${ride.destination_address}</strong>.</p>
          <p style="color:#555">There are now <strong>${totalPassengers?.count ?? "?"}</strong> passengers on this trip. The fare will be split equally.</p>
        `);

    const subject = isDriver
      ? `New passenger joined — ${newPassenger?.name}`
      : `${newPassenger?.name} joined your trip`;

    await send(person.email, subject, html);
  }
}

export async function emailBookingAccepted(bookingId: string) {
  const booking = await queryOne<{
    passenger_id: string;
    ride_id: string;
    pickup_address: string | null;
    fare_at_booking: number | null;
  }>(
    "SELECT passenger_id, ride_id, pickup_address, fare_at_booking FROM bookings WHERE booking_id = $1",
    [bookingId]
  );
  if (!booking) return;

  const passenger = await queryOne<{ email: string | null; name: string }>(
    "SELECT email, name FROM users WHERE user_id = $1", [booking.passenger_id]
  );
  if (!passenger?.email) return;

  const ride = await queryOne<{ destination_address: string; initiator_id: string }>(
    "SELECT destination_address, initiator_id FROM rides WHERE ride_id = $1", [booking.ride_id]
  );
  const driver = await queryOne<{ name: string; rating: number; phone: string }>(
    "SELECT name, rating, phone FROM users WHERE user_id = $1", [ride?.initiator_id]
  );

  await send(passenger.email, "Your booking has been accepted!", base(`
    <p>Hi ${passenger.name},</p>
    <p>Your seat on the trip to <strong>${ride?.destination_address}</strong> has been <strong style="color:#0F6E56">accepted</strong>!</p>
    <div style="background:#f0faf6;border-radius:12px;padding:16px;margin:16px 0">
      <p style="margin:0 0 8px 0"><strong>Driver:</strong> ${driver?.name}</p>
      <p style="margin:0 0 8px 0"><strong>Rating:</strong> ★ ${Number(driver?.rating).toFixed(1)}</p>
      <p style="margin:0 0 8px 0"><strong>Driver phone:</strong> ${driver?.phone}</p>
      <p style="margin:0 0 8px 0"><strong>Your pickup:</strong> ${booking.pickup_address ?? "Not specified"}</p>
      <p style="margin:0"><strong>Your fare:</strong> ${booking.fare_at_booking ? `${(booking.fare_at_booking / 100).toFixed(0)} kr` : "TBD"}</p>
    </div>
    <p>Get ready at your pickup point. You'll be notified when the driver is close.</p>
  `));
}
