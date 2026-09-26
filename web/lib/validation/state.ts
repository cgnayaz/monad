import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

export const StateInputSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_.]+$/),
    value: z.union([z.string(), z.number(), z.null()]),
    unit: z.string().optional(),
    source: z.enum(["pyth-hermes", "monad-rpc", "decision-registry", "execution-vault"]),
    sourceRef: z.string().optional(),
    observedAt: z.number().int().positive(),
    status: z.enum(["ok", "unavailable", "stale"]),
    note: z.string().optional(),
  })
  .strict()
  .refine((i) => (i.status === "ok") === (i.value !== null), {
    message: "value must be null exactly when status is not ok",
  });

export const JevStateSchema = z
  .object({
    schema: z.literal("decmarkt.jev.state/1"),
    stateId: z.string().regex(/^st_[0-9a-f]{16}$/),
    subject: z
      .object({
        vault: address.nullable(),
        asset: z.literal("MON"),
        referenceFeed: z.literal("MON/USD"),
        horizonSec: z.number().int().positive(),
        bandBps: z.number().int().min(0).max(1000),
      })
      .strict(),
    observedAt: z.number().int().positive(),
    inputs: z.array(StateInputSchema).min(1),
  })
  .strict();
