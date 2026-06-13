import axios from "axios";
import { query, queryOne } from "../../db";

interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendPush(userId: string, payload: PushPayload): Promise<void> {
  const user = await queryOne<{ fcm_token: string | null }>(
    "SELECT fcm_token FROM users WHERE user_id = $1",
    [userId]
  );
  if (!user?.fcm_token) return;

  const fcmKey = process.env.FCM_SERVER_KEY;
  let fcmResult = "no_key";

  if (fcmKey) {
    try {
      const resp = await axios.post(
        "https://fcm.googleapis.com/fcm/send",
        {
          to: user.fcm_token,
          notification: { title: payload.title, body: payload.body },
          data: payload.data ?? {},
        },
        { headers: { Authorization: `key=${fcmKey}` } }
      );
      fcmResult = resp.data?.success === 1 ? "ok" : "failed";
    } catch {
      fcmResult = "error";
    }
  }

  await query(
    `INSERT INTO notification_log (user_id, type, title, body, fcm_result)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, payload.data?.type ?? "generic", payload.title, payload.body, fcmResult]
  );
}

export async function notifyBookingPassengers(rideId: string, payload: PushPayload) {
  const passengers = await query<{ passenger_id: string }>(
    `SELECT passenger_id FROM bookings
     WHERE ride_id = $1 AND status IN ('confirmed', 'boarded')`,
    [rideId]
  );
  await Promise.all(passengers.map((p) => sendPush(p.passenger_id, payload)));
}

export async function notifyRideInitiator(rideId: string, payload: PushPayload) {
  const ride = await queryOne<{ initiator_id: string }>(
    "SELECT initiator_id FROM rides WHERE ride_id = $1",
    [rideId]
  );
  if (ride) await sendPush(ride.initiator_id, payload);
}
