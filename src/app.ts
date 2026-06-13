import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import authRouter from "./services/auth/auth.router";
import rideRouter from "./services/ride/ride.router";
import bookingRouter from "./services/booking/booking.router";
import matchRouter from "./services/match/match.router";
import fareRouter from "./services/fare/fare.router";
import paymentRouter from "./services/payment/payment.router";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(morgan("dev"));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok", ts: new Date() }));

  app.use("/auth",     authRouter);
  app.use("/rides",    rideRouter);
  app.use("/bookings", bookingRouter);
  app.use("/match",    matchRouter);
  app.use("/fares",    fareRouter);
  app.use("/payments", paymentRouter);

  app.use(errorHandler);

  return app;
}
