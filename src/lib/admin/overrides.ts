import { getResolution, isValidCell } from "h3-js";
import { z } from "zod";
import { H3_RESOLUTION } from "@/lib/geo";

/** Body of POST /api/admin/overrides. */
export const overrideInputSchema = z
  .object({
    h3: z.string().refine((h) => isValidCell(h) && getResolution(h) === H3_RESOLUTION, "must be a res-9 H3 cell"),
    level: z.number().int().min(0).max(4),
    reason: z.string().trim().min(3).max(200),
    /** 5 minutes to 3 days. */
    expiresInMinutes: z.number().int().min(5).max(3 * 24 * 60),
  })
  .strict();

export const overrideDeleteSchema = z.object({ h3: z.string() }).strict();

export type OverrideInput = z.infer<typeof overrideInputSchema>;
