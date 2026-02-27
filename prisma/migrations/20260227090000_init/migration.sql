CREATE TYPE "RuleType" AS ENUM ('TOKEN_AMOUNT', 'TOKEN_USD', 'NFT_COLLECTION');
CREATE TYPE "PriceSource" AS ENUM ('COINGECKO');
CREATE TYPE "AuditAction" AS ENUM ('ROLE_ADDED', 'ROLE_REMOVED', 'VERIFY_SUCCESS', 'VERIFY_REPLACED', 'VERIFY_UNLINKED');

CREATE TABLE "guilds" (
  "guild_id" TEXT PRIMARY KEY,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "wallet_links" (
  "id" TEXT PRIMARY KEY,
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "wallet_pubkey" TEXT NOT NULL,
  "verified_at" TIMESTAMP(3) NOT NULL,
  "last_checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_links_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "verify_sessions" (
  "id" TEXT PRIMARY KEY,
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "nonce" TEXT NOT NULL UNIQUE,
  "challenge_message" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "gating_rules" (
  "id" TEXT PRIMARY KEY,
  "guild_id" TEXT NOT NULL,
  "type" "RuleType" NOT NULL,
  "mint" TEXT,
  "collection" TEXT,
  "threshold_amount" DECIMAL(38,12),
  "threshold_usd" DECIMAL(38,12),
  "threshold_count" INTEGER,
  "role_id" TEXT NOT NULL,
  "price_source" "PriceSource",
  "price_asset_id" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by_discord_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gating_rules_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("guild_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "audit_log" (
  "id" TEXT PRIMARY KEY,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "guild_id" TEXT NOT NULL,
  "discord_user_id" TEXT NOT NULL,
  "rule_id" TEXT,
  "role_id" TEXT NOT NULL,
  "action" "AuditAction" NOT NULL,
  "reason" TEXT NOT NULL
);

CREATE TABLE "price_cache" (
  "asset_id" TEXT PRIMARY KEY,
  "price_usd" DECIMAL(38,12) NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "wallet_links_guild_id_discord_user_id_key" ON "wallet_links"("guild_id", "discord_user_id");
CREATE INDEX "wallet_links_guild_id_idx" ON "wallet_links"("guild_id");
CREATE INDEX "wallet_links_discord_user_id_idx" ON "wallet_links"("discord_user_id");
CREATE INDEX "verify_sessions_guild_id_discord_user_id_idx" ON "verify_sessions"("guild_id", "discord_user_id");
CREATE INDEX "verify_sessions_expires_at_idx" ON "verify_sessions"("expires_at");
CREATE INDEX "gating_rules_guild_id_enabled_idx" ON "gating_rules"("guild_id", "enabled");
CREATE INDEX "gating_rules_guild_id_role_id_idx" ON "gating_rules"("guild_id", "role_id");
CREATE INDEX "gating_rules_type_mint_idx" ON "gating_rules"("type", "mint");
CREATE INDEX "gating_rules_type_collection_idx" ON "gating_rules"("type", "collection");
CREATE INDEX "audit_log_guild_id_timestamp_idx" ON "audit_log"("guild_id", "timestamp");
CREATE INDEX "audit_log_discord_user_id_timestamp_idx" ON "audit_log"("discord_user_id", "timestamp");
CREATE INDEX "price_cache_fetched_at_idx" ON "price_cache"("fetched_at");
