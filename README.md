# Discord Solana Gating Bot

Production-ready MVP for Discord role gating with Solana token amount, USD value, and verified NFT collection rules.

## Features

- Secure wallet verification via signed challenge (Ed25519)
- Rule engine per guild:
  - `TOKEN_AMOUNT`: wallet balance >= threshold
  - `TOKEN_USD`: balance * CoinGecko price >= threshold
  - `NFT_COLLECTION`: verified collection NFT count >= threshold
- Automatic role add/remove with OR semantics for shared roles
- Fail-open behavior on upstream outages (no accidental role removals)
- Scheduler polling every 12 hours (configurable)
- Immediate recheck on verify and rule changes
- Audit log + retention cleanup
- Admin web UI for guild settings (Discord OAuth login, rule management, audit view)

## Stack

- Node.js + TypeScript
- discord.js + Fastify
- Solana RPC + DAS endpoint
- PostgreSQL + Prisma

## Setup

1. Copy `.env.example` to `.env` and fill values.
2. Install deps:

```bash
npm install
```

3. Generate Prisma client and run migrations:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Register slash commands:

```bash
npm run commands:register
```

5. Start in dev mode:

```bash
npm run dev
```

6. Build admin UI (for `/admin` route):

```bash
npm run build:admin
```

## Docker

```bash
docker compose up --build
```

### VPS Install Script (Ubuntu/Debian)

One-shot installer for Docker + app bootstrap:

```bash
chmod +x scripts/vps_install.sh
./scripts/vps_install.sh
```

What it does:
- installs Docker Engine + Compose (if missing)
- creates `.env` from `.env.example` (if missing)
- sets Docker-internal `DATABASE_URL` (`postgres` service host)
- validates required `.env` secrets/URLs
- runs `docker compose up -d --build`
- health-checks `http://localhost:3000/healthz`
- registers slash commands inside the app container

### VPS Update Script (Ubuntu/Debian)

For future deployments (pull latest + rebuild + restart):

```bash
chmod +x scripts/vps_update.sh
./scripts/vps_update.sh
```

What it does:
- verifies clean git working tree
- pulls latest changes (`--ff-only`) for current branch
- rebuilds and restarts Docker services
- waits for app health on `http://localhost:3000/healthz`
- re-registers slash commands

## Commands

- `/verify`
- `/unlink`
- `/gating add-token-amount mint amount role`
- `/gating add-token-usd mint usd role coingecko_id`
- `/gating add-nft-collection collection count role`
- `/gating list`
- `/gating remove rule_id`
- `/gating enable rule_id`
- `/gating disable rule_id`
- `/gating run-now [user]`
- `/gating post-verify-panel [title] [requirement]`

## Admin UI

- Open `http://localhost:3000/admin`
- Sign in with Discord (OAuth)
- Choose a guild and manage rules
- Trigger manual rechecks and inspect recent audit events

## Isolated Local Test on :3001

Use this when another app is already running on `http://localhost:3000`.

1. Create local test env:
```bash
cp .env.example .env.local.3001
```
2. Edit `.env.local.3001` and set:
   - `PORT=3001`
   - `VERIFY_BASE_URL=http://localhost:3001/verify`
   - `ADMIN_UI_BASE_URL=http://localhost:3001/admin`
   - `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/discord_gating_local`
   - real Discord values for `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`
3. Start only Postgres for this repo:
```bash
docker compose up -d postgres
```
4. Load env and prepare runtime:
```bash
set -a
source .env.local.3001
set +a
npm run prisma:generate
npm run prisma:deploy
npm run build
```
5. Start isolated instance:
```bash
npm run start:3001
```
6. Run smoke checks in another terminal:
```bash
npm run smoke:3001
```

Optional for authorized `/internal/recheck` test:
```bash
TEST_GUILD_ID=<guild-id> npm run smoke:3001
```

## Verify Flow

1. User runs `/verify`
2. User opens verify link
3. Browser loads challenge and signs it with wallet
4. Signature is verified and wallet link is stored
5. Worker runs immediate recheck and assigns/removes roles

## Important Notes

- Bot role must be higher than managed roles.
- Bot needs `Manage Roles` and `Manage Server` (`ManageGuild`) permissions.
- Users running `/gating ...` commands need `Manage Server` permission.
- One wallet per user per guild.
- NFT rules count only verified collection memberships.
