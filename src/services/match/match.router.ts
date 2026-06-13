import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/auth";
import { findMatches } from "./match.service";

const router = Router();

const MatchSchema = z.object({
  origin_lat: z.number(),
  origin_lng: z.number(),
  destination_lat: z.number(),
  destination_lng: z.number(),
});

// POST /match  — passenger smart match
router.post("/", requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = MatchSchema.parse(req.body);
    const results = await findMatches({
      originLat: body.origin_lat,
      originLng: body.origin_lng,
      destinationLat: body.destination_lat,
      destinationLng: body.destination_lng,
    });

    if (results.length === 0) {
      res.json({ matches: [], message: "No rides found. Try posting a future trip." });
      return;
    }
    res.json({ matches: results });
  } catch (err) { next(err); }
});

export default router;
