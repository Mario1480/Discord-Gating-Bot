import { z } from "zod";

export const loginQuerySchema = z.object({
  redirect: z.string().optional()
});

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  action: z.string().optional(),
  discord_user_id: z.string().optional(),
  date_from: z.string().datetime().optional(),
  date_to: z.string().datetime().optional()
});

export const recheckBodySchema = z.object({
  discord_user_id: z.string().optional()
});

const baseRuleSchema = z.object({
  role_id: z.string().min(1)
});

export const createRuleSchema = z.discriminatedUnion("type", [
  baseRuleSchema.extend({
    type: z.literal("TOKEN_AMOUNT"),
    mint: z.string().min(1),
    amount: z.number().nonnegative()
  }),
  baseRuleSchema.extend({
    type: z.literal("TOKEN_USD"),
    mint: z.string().min(1),
    usd: z.number().nonnegative(),
    coingecko_id: z.string().min(1)
  }),
  baseRuleSchema.extend({
    type: z.literal("NFT_COLLECTION"),
    collection: z.string().min(1),
    count: z.number().int().nonnegative()
  })
]);

export const updateRuleSchema = z.discriminatedUnion("type", [
  baseRuleSchema.extend({
    type: z.literal("TOKEN_AMOUNT"),
    mint: z.string().min(1),
    amount: z.number().nonnegative(),
    enabled: z.boolean().optional()
  }),
  baseRuleSchema.extend({
    type: z.literal("TOKEN_USD"),
    mint: z.string().min(1),
    usd: z.number().nonnegative(),
    coingecko_id: z.string().min(1),
    enabled: z.boolean().optional()
  }),
  baseRuleSchema.extend({
    type: z.literal("NFT_COLLECTION"),
    collection: z.string().min(1),
    count: z.number().int().nonnegative(),
    enabled: z.boolean().optional()
  })
]);
