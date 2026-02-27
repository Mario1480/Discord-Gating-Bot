import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),

  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_GUILD_IDS: z.string().optional(),
  DISCORD_OAUTH_SCOPES: z.string().default("identify guilds"),

  SOLANA_RPC_URL: z.string().url(),
  SOLANA_DAS_URL: z.string().url(),

  VERIFY_BASE_URL: z.string().url(),
  VERIFY_TOKEN_SECRET: z.string().min(32),
  INTERNAL_API_SECRET: z.string().min(16),

  ADMIN_UI_BASE_URL: z.string().url(),
  ADMIN_SESSION_SECRET: z.string().min(32),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),

  COINGECKO_BASE_URL: z.string().url().default("https://api.coingecko.com/api/v3"),

  CHECK_CONCURRENCY: z.coerce.number().int().positive().default(20),
  POLL_CRON: z.string().default("0 */12 * * *"),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().positive().default(90)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  discordGuildIds: (parsed.data.DISCORD_GUILD_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
  adminUiOrigin: new URL(parsed.data.ADMIN_UI_BASE_URL).origin,
  adminCallbackUrl: `${new URL(parsed.data.ADMIN_UI_BASE_URL).origin}/auth/callback`
};
