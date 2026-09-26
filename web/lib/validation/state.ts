import { z } from "zod";

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const source = z.enum(["pyth-hermes", "monad-rpc", "decision-registry", "execution-vault"]);

export const StateInputSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_.]+$/),
    value: z.union([z.string(), z.number(), z.null()]),
    unit: z.string().optional(),
    source,
    sourceRef: z.string().optional(),
    observedAt: z.number().int().positive(),
    status: z.enum(["ok", "unavailable", "stale"]),
    note: z.string().optional(),
  })
  .strict()
  .refine((i) => (i.status === "ok") === (i.value !== null), {
    message: "value must be null exactly when status is not ok",
  });

const StateBody = z
  .object({
    stateId: z.string().regex(/^st_[0-9a-f]{16}$/),
    version: z.literal("decmarkt.jev.state/1"),
    source: z.array(source).min(1),
    timestamp: z.number().int().positive(),
    data: z
      .object({
        subject: z
          .object({
            vault: address.nullable(),
            asset: z.literal("MON"),
            referenceFeed: z.string().regex(/^[A-Z0-9]{2,10}\/USD$/),
            horizonSec: z.number().int().positive(),
            bandBps: z.number().int().min(0).max(1000),
          })
          .strict(),
        inputs: z.array(StateInputSchema).min(1),
      })
      .strict(),
  })
  .strict();

/** A state body before hashing (every StateRecord field except `hash`). */
export const StateBodySchema = StateBody;

/** A complete StateRecord as stored in the payload store. */
export const StateRecordSchema = StateBody.extend({ hash: hex32 }).strict();
