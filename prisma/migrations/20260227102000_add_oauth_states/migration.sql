CREATE TABLE "oauth_states" (
  "state" TEXT PRIMARY KEY,
  "nonce" TEXT NOT NULL,
  "redirect_path" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");
