import axios from "axios";
import { query, queryOne } from "../../db";
import { sendPush } from "../notification/notification.service";

export type PaymentProvider = "vipps" | "stripe";

// ─── Vipps ───────────────────────────────────────────────────────────────────

async function getVippsToken(): Promise<string> {
  const resp = await axios.post(
    `${process.env.VIPPS_BASE_URL}/accesstoken/get`,
    {},
    {
      headers: {
        client_id: process.env.VIPPS_CLIENT_ID,
        client_secret: process.env.VIPPS_CLIENT_SECRET,
        "Ocp-Apim-Subscription-Key": process.env.VIPPS_SUBSCRIPTION_KEY,
      },
    }
  );
  return resp.data.access_token as string;
}

async function initiateVippsPayment(
  amountOre: number,
  orderId: string,
  phone: string
): Promise<string> {
  const token = await getVippsToken();
  const resp = await axios.post(
    `${process.env.VIPPS_BASE_URL}/ecomm/v2/payments`,
    {
      customerInfo: { mobileNumber: phone.replace("+47", "") },
      merchantInfo: {
        callbackPrefix: `${process.env.PUBLIC_URL ?? "https://api.samkjor.no"}/payments/vipps/callback`,
        merchantSerialNumber: process.env.VIPPS_MERCHANT_SERIAL_NUMBER,
      },
      transaction: {
        amount: amountOre,
        orderId,
        timeStamp: new Date().toISOString(),
        transactionText: "SamKjør ride share",
      },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Ocp-Apim-Subscription-Key": process.env.VIPPS_SUBSCRIPTION_KEY,
        "X-Request-Id": orderId,
      },
    }
  );
  return resp.data.url as string; // deeplink to Vipps app
}

// ─── Stripe ──────────────────────────────────────────────────────────────────

async function initiateStripePayment(
  amountOre: number,
  customerId: string
): Promise<string> {
  const resp = await axios.post(
    "https://api.stripe.com/v1/payment_intents",
    new URLSearchParams({
      amount: String(amountOre),
      currency: "nok",
      customer: customerId,
      capture_method: "manual", // hold funds now, capture after ride
      confirm: "true",
    }),
    {
      auth: { username: process.env.STRIPE_SECRET_KEY ?? "", password: "" },
    }
  );
  return resp.data.id as string; // payment intent ID
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function holdPayment(bookingId: string): Promise<{
  provider: PaymentProvider;
  providerRef: string;
  deeplink?: string;
}> {
  const row = await queryOne<{
    booking_id: string;
    ride_id: string;
    passenger_id: string;
    fare_at_booking: number | null;
    phone: string;
    payment_method_id: string | null;
    base_fare: number;
    ride_type: string;
  }>(
    `SELECT b.booking_id, b.ride_id, b.passenger_id, b.fare_at_booking,
            u.phone, u.payment_method_id,
            r.base_fare, r.ride_type
     FROM bookings b
     JOIN users u ON u.user_id = b.passenger_id
     JOIN rides r ON r.ride_id = b.ride_id
     WHERE b.booking_id = $1`,
    [bookingId]
  );
  if (!row) throw new Error("Booking not found");

  const amount = row.fare_at_booking ?? row.base_fare; // fallback to base fare
  const orderId = `sk-${bookingId.slice(0, 8)}`;

  let provider: PaymentProvider;
  let providerRef: string;
  let deeplink: string | undefined;

  if (process.env.VIPPS_CLIENT_ID) {
    provider = "vipps";
    deeplink = await initiateVippsPayment(amount, orderId, row.phone);
    providerRef = orderId;
  } else if (process.env.STRIPE_SECRET_KEY && row.payment_method_id) {
    provider = "stripe";
    providerRef = await initiateStripePayment(amount, row.payment_method_id);
  } else {
    // Stub for development — record payment as held without a real provider
    provider = "stripe";
    providerRef = `stub-${bookingId}`;
  }

  await query(
    `INSERT INTO payments (booking_id, user_id, amount, provider, provider_ref, status)
     VALUES ($1, $2, $3, $4, $5, 'held')`,
    [bookingId, row.passenger_id, amount, provider, providerRef]
  );

  return { provider, providerRef, deeplink };
}

export async function capturePayments(rideId: string): Promise<void> {
  const bookings = await query<{ booking_id: string; passenger_id: string }>(
    `SELECT booking_id, passenger_id FROM bookings
     WHERE ride_id = $1 AND status = 'completed'`,
    [rideId]
  );

  for (const b of bookings) {
    const payment = await queryOne<{
      payment_id: string;
      provider: PaymentProvider;
      provider_ref: string;
      amount: number;
    }>(
      `SELECT payment_id, provider, provider_ref, amount
       FROM payments WHERE booking_id = $1 AND status = 'held'
       ORDER BY created_at DESC LIMIT 1`,
      [b.booking_id]
    );
    if (!payment) continue;

    // Real capture would call Vipps/Stripe here
    await query(
      `UPDATE payments SET status = 'captured', settled_at = NOW()
       WHERE payment_id = $1`,
      [payment.payment_id]
    );

    await sendPush(b.passenger_id, {
      title: "Payment processed",
      body: `Your payment of ${(payment.amount / 100).toFixed(2)} kr has been processed.`,
      data: { type: "payment_captured", bookingId: b.booking_id },
    });
  }
}

export async function refundPayment(bookingId: string): Promise<void> {
  await query(
    `UPDATE payments SET status = 'refunded', settled_at = NOW()
     WHERE booking_id = $1 AND status IN ('held','captured')`,
    [bookingId]
  );
}
