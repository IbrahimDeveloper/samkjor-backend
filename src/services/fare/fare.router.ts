import { Router, Request, Response, NextFunction } from "express";
import { requireAuth } from "../../middleware/auth";
import { getFareSummary, computeBaseFare } from "./fare.service";

const router = Router();

// GET /fares/:rideId  — current split fare summary
router.get("/:rideId", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const summary = await getFareSummary(req.params.rideId);
    if (!summary) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// GET /fares/estimate?distance=<metres>&city=<city>
router.get("/estimate", requireAuth, (req: Request, res: Response) => {
  const distance = Number(req.query.distance);
  const city = (req.query.city as string) ?? "oslo";
  if (!distance || distance <= 0) {
    res.status(400).json({ error: "distance is required and must be positive" });
    return;
  }
  const base_fare = computeBaseFare(distance, city);
  res.json({ distance_metres: distance, city, base_fare, base_fare_nok: base_fare / 100 });
});

export default router;
