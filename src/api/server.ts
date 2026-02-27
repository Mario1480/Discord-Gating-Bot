import fs from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import { AuditAction, PriceSource, Prisma, RuleType } from "@prisma/client";
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Client } from "discord.js";
import { z } from "zod";
import {
  assertValidOriginForMutation,
  requireAdminSession,
  requireGuildAccess
} from "../admin/authMiddleware";
import {
  clearAdminSessionCookie,
  completeDiscordOAuthCallback,
  makeAdminSessionCookie,
  startDiscordOAuthLogin
} from "../admin/authService";
import {
  auditQuerySchema,
  createRuleSchema,
  loginQuerySchema,
  oauthCallbackQuerySchema,
  recheckBodySchema as adminRecheckBodySchema,
  updateRuleSchema
} from "../admin/dto";
import { DiscordAdminClient } from "../admin/discordAdminClient";
import { env } from "../config/env";
import { prisma } from "../db/client";
import {
  addNftCollectionRule,
  addTokenAmountRule,
  addTokenUsdRule,
  listGuildRules,
  removeRule
} from "../services/ruleService";
import { createVerifySession, getVerifyChallenge, submitVerifySignature } from "../services/verifyService";
import { logger } from "../utils/logger";
import { GatingWorker } from "../worker/gatingWorker";

const verifySessionBodySchema = z.object({
  guild_id: z.string().min(1),
  discord_user_id: z.string().min(1)
});

const verifyChallengeQuerySchema = z.object({
  token: z.string().min(1)
});

const verifySubmitBodySchema = z.object({
  token: z.string().min(1),
  wallet_pubkey: z.string().min(32),
  signature_base58: z.string().min(64)
});

const internalRecheckBodySchema = z.object({
  guild_id: z.string().min(1),
  discord_user_id: z.string().min(1).optional()
});

const adminGuildParamsSchema = z.object({
  guildId: z.string().min(1)
});

const adminRuleParamsSchema = z.object({
  guildId: z.string().min(1),
  ruleId: z.string().min(1)
});

const adminStaticRoot = path.resolve(__dirname, "../web-admin");
const adminIndexFile = path.join(adminStaticRoot, "index.html");

function isInternalAuthorized(request: FastifyRequest): boolean {
  const header = request.headers["x-internal-secret"];
  return typeof header === "string" && header === env.INTERNAL_API_SECRET;
}

function rejectUnauthorized(reply: FastifyReply): FastifyReply {
  return reply.status(401).send({ error: "unauthorized" });
}

type SerializedRule = {
  id: string;
  type: RuleType;
  role_id: string;
  mint: string | null;
  collection: string | null;
  amount: number | null;
  usd: number | null;
  count: number | null;
  coingecko_id: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

function serializeRule(rule: {
  id: string;
  type: RuleType;
  roleId: string;
  mint: string | null;
  collection: string | null;
  thresholdAmount: Prisma.Decimal | null;
  thresholdUsd: Prisma.Decimal | null;
  thresholdCount: number | null;
  priceAssetId: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SerializedRule {
  return {
    id: rule.id,
    type: rule.type,
    role_id: rule.roleId,
    mint: rule.mint,
    collection: rule.collection,
    amount: rule.thresholdAmount ? Number(rule.thresholdAmount.toString()) : null,
    usd: rule.thresholdUsd ? Number(rule.thresholdUsd.toString()) : null,
    count: rule.thresholdCount,
    coingecko_id: rule.priceAssetId,
    enabled: rule.enabled,
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString()
  };
}

function parseGuildIdOrReply(request: FastifyRequest, reply: FastifyReply): string | null {
  const parsed = adminGuildParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    void reply.status(400).send({ error: parsed.error.flatten() });
    return null;
  }
  return parsed.data.guildId;
}

function parseGuildAndRuleIdOrReply(
  request: FastifyRequest,
  reply: FastifyReply
): { guildId: string; ruleId: string } | null {
  const parsed = adminRuleParamsSchema.safeParse(request.params);
  if (!parsed.success) {
    void reply.status(400).send({ error: parsed.error.flatten() });
    return null;
  }

  return parsed.data;
}

function adminBuildMissingHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Admin UI Missing</title>
    <style>
      body { font-family: ui-sans-serif, system-ui; max-width: 760px; margin: 2rem auto; padding: 1rem; }
      code { background: #f3f3f3; padding: 0.15rem 0.35rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>Admin UI build not found</h1>
    <p>Build the frontend with <code>npm run build:admin</code> and restart this service.</p>
  </body>
</html>`;
}

export function buildApiServer(worker: GatingWorker, discordClient: Client): FastifyInstance {
  const app = Fastify({ logger: false });
  const discordAdminClient = new DiscordAdminClient(discordClient);
  const hasAdminBuild = fs.existsSync(adminIndexFile);

  if (hasAdminBuild) {
    void app.register(fastifyStatic, {
      root: adminStaticRoot,
      prefix: "/admin/static/",
      index: false,
      wildcard: false
    });
  }

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/verify", async (request, reply) => {
    const query = verifyChallengeQuerySchema.safeParse(request.query);
    const token = query.success ? query.data.token : "";

    if (!token) {
      return reply
        .type("text/html")
        .send("<html><body><h2>Missing verify token</h2><p>Run /verify in Discord first.</p></body></html>");
    }

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Wallet Verify</title>
  <style>
    body { font-family: sans-serif; max-width: 720px; margin: 2rem auto; padding: 1rem; }
    button { padding: 0.75rem 1rem; margin-right: 0.5rem; }
    pre { white-space: pre-wrap; background: #f6f8fa; padding: 0.75rem; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Discord Wallet Verification</h1>
  <p>Connect your Solana wallet and sign the challenge.</p>
  <pre id="challenge">Loading challenge...</pre>
  <button id="connect">Connect Wallet</button>
  <button id="sign" disabled>Sign & Submit</button>
  <p id="status"></p>

  <script>
    const token = new URLSearchParams(window.location.search).get("token");
    const statusEl = document.getElementById("status");
    const challengeEl = document.getElementById("challenge");
    const connectBtn = document.getElementById("connect");
    const signBtn = document.getElementById("sign");

    let challenge = "";
    let provider = null;

    const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    function encodeBase58(bytes) {
      if (!bytes || bytes.length === 0) return "";
      const digits = [0];
      for (let i = 0; i < bytes.length; i += 1) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j += 1) {
          const x = digits[j] * 256 + carry;
          digits[j] = x % 58;
          carry = (x / 58) | 0;
        }
        while (carry) {
          digits.push(carry % 58);
          carry = (carry / 58) | 0;
        }
      }
      let result = "";
      for (let k = 0; k < bytes.length && bytes[k] === 0; k += 1) {
        result += ALPHABET[0];
      }
      for (let q = digits.length - 1; q >= 0; q -= 1) {
        result += ALPHABET[digits[q]];
      }
      return result;
    }

    async function loadChallenge() {
      const res = await fetch("/verify/challenge?token=" + encodeURIComponent(token));
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to load challenge");
      }
      challenge = data.challenge_message;
      challengeEl.textContent = challenge + "\\nExpires: " + data.expires_at;
    }

    connectBtn.onclick = async () => {
      provider = window.solana || window.backpack;
      if (!provider) {
        statusEl.textContent = "No Solana wallet extension found.";
        return;
      }
      try {
        await provider.connect();
        signBtn.disabled = false;
        statusEl.textContent = "Wallet connected: " + provider.publicKey.toString();
      } catch (e) {
        statusEl.textContent = "Wallet connect failed: " + (e.message || String(e));
      }
    };

    signBtn.onclick = async () => {
      if (!provider || !challenge) {
        return;
      }
      try {
        const encoded = new TextEncoder().encode(challenge);
        const signed = await provider.signMessage(encoded, "utf8");
        const signatureBytes = signed.signature || signed;
        const signatureBase58 = encodeBase58(signatureBytes);

        const res = await fetch("/verify/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token,
            wallet_pubkey: provider.publicKey.toString(),
            signature_base58: signatureBase58
          })
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Verification failed");
        }
        statusEl.textContent = "Verification successful. You can return to Discord.";
      } catch (e) {
        statusEl.textContent = "Verification failed: " + (e.message || String(e));
      }
    };

    loadChallenge().catch((e) => {
      challengeEl.textContent = "Failed loading challenge.";
      statusEl.textContent = e.message || String(e);
    });
  </script>
</body>
</html>`;

    return reply.type("text/html").send(html);
  });

  app.post("/verify/session", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return rejectUnauthorized(reply);
    }

    const parsed = verifySessionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const session = await createVerifySession({
      guildId: parsed.data.guild_id,
      discordUserId: parsed.data.discord_user_id
    });

    return reply.send({
      token: session.token,
      verify_url: session.verifyUrl,
      expires_at: session.expiresAt.toISOString()
    });
  });

  app.get("/verify/challenge", async (request, reply) => {
    const parsed = verifyChallengeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const challenge = await getVerifyChallenge(parsed.data.token);
      return reply.send({
        challenge_message: challenge.challengeMessage,
        expires_at: challenge.expiresAt.toISOString()
      });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "verify failed" });
    }
  });

  app.post("/verify/submit", async (request, reply) => {
    const parsed = verifySubmitBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const result = await submitVerifySignature({
        token: parsed.data.token,
        walletPubkey: parsed.data.wallet_pubkey,
        signatureBase58: parsed.data.signature_base58
      });

      await worker.enqueueRecheck(result.guildId, result.discordUserId);

      return reply.send({
        ok: true,
        guild_id: result.guildId,
        discord_user_id: result.discordUserId,
        replaced: result.replaced
      });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "verify failed" });
    }
  });

  app.post("/internal/recheck", async (request, reply) => {
    if (!isInternalAuthorized(request)) {
      return rejectUnauthorized(reply);
    }

    const parsed = internalRecheckBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    await worker.enqueueRecheck(parsed.data.guild_id, parsed.data.discord_user_id);

    return reply.send({ ok: true });
  });

  app.get("/admin/login", async (request, reply) => {
    const query = loginQuerySchema.safeParse(request.query);

    const authorizeUrl = await startDiscordOAuthLogin({
      redirectPath: query.success ? query.data.redirect : undefined
    });

    return reply.redirect(authorizeUrl);
  });

  app.get("/auth/callback", async (request, reply) => {
    const query = oauthCallbackQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: query.error.flatten() });
    }

    try {
      const result = await completeDiscordOAuthCallback({
        code: query.data.code,
        state: query.data.state,
        discordClient
      });

      const cookie = makeAdminSessionCookie(result.sessionToken);
      reply.header("set-cookie", cookie);

      return reply.redirect(result.redirectPath);
    } catch (error) {
      logger.warn("Admin OAuth callback failed", {
        error: error instanceof Error ? error.message : String(error)
      });

      return reply.status(400).send({ error: error instanceof Error ? error.message : "oauth_failed" });
    }
  });

  app.post("/admin/logout", async (request, reply) => {
    if (!assertValidOriginForMutation(request, reply)) {
      return;
    }

    reply.header("set-cookie", clearAdminSessionCookie());
    return reply.send({ ok: true });
  });

  app.get("/admin/api/session", async (request, reply) => {
    const session = requireAdminSession(request, reply);
    if (!session) {
      return;
    }

    return reply.send({ authenticated: true, session });
  });

  app.get("/admin/api/guilds", async (request, reply) => {
    const session = requireAdminSession(request, reply);
    if (!session) {
      return;
    }

    return reply.send({ items: session.guilds });
  });

  app.get("/admin/api/guilds/:guildId/roles", async (request, reply) => {
    const session = requireAdminSession(request, reply);
    if (!session) {
      return;
    }

    const guildId = parseGuildIdOrReply(request, reply);
    if (!guildId) {
      return;
    }

    if (!requireGuildAccess(session, guildId, reply)) {
      return;
    }

    const roles = await discordAdminClient.listGuildRoles(guildId);
    return reply.send({ items: roles });
  });

  app.get("/admin/api/guilds/:guildId/rules", async (request, reply) => {
    const session = requireAdminSession(request, reply);
    if (!session) {
      return;
    }

    const guildId = parseGuildIdOrReply(request, reply);
    if (!guildId) {
      return;
    }

    if (!requireGuildAccess(session, guildId, reply)) {
      return;
    }

    const rules = await listGuildRules(guildId);
    return reply.send({ items: rules.map((rule) => serializeRule(rule)) });
  });

  app.post("/admin/api/guilds/:guildId/rules", async (request, reply) => {
    const session = requireAdminSession(request, reply);
    if (!session) {
      return;
    }

    if (!assertValidOriginForMutation(request, reply)) {
      return;
    }

    const guildId = parseGuildIdOrReply(request, reply);
    if (!guildId) {
      return;
    }

    if (!requireGuildAccess(session, guildId, reply)) {
      return;
    }

    const body = createRuleSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    let created;
    if (body.data.type === "TOKEN_AMOUNT") {
      created = await addTokenAmountRule({
        guildId,
        createdByDiscordUserId: session.discordUserId,
        mint: body.data.mint.trim(),
        amount: body.data.amount,
        roleId: body.data.role_id
      });
    } else if (body.data.type === "TOKEN_USD") {
      created = await addTokenUsdRule({
        guildId,
        createdByDiscordUserId: session.discordUserId,
        mint: body.data.mint.trim(),
        usd: body.data.usd,
        roleId: body.data.role_id,
        priceAssetId: body.data.coingecko_id.trim()
      });
    } else {
      created = await addNftCollectionRule({
        guildId,
        createdByDiscordUserId: session.discordUserId,
        collection: body.data.collection.trim(),
        count: body.data.count,
        roleId: body.data.role_id
      });
    }

    await worker.enqueueRecheck(guildId);

    return reply.status(201).send({ item: serializeRule(created) });
  });

  app.put("/admin/api/guilds/:guildId/rules/:ruleId", async (request, reply) => {
    const session = requireAdminSession(request, reply);
    if (!session) {
      return;
    }

    if (!assertValidOriginForMutation(request, reply)) {
      return;
    }

    const ids = parseGuildAndRuleIdOrReply(request, reply);
    if (!ids) {
      return;
    }

    if (!requireGuildAccess(session, ids.guildId, reply)) {
      return;
    }

    const body = updateRuleSchema.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    let data: Prisma.GatingRuleUpdateManyMutationInput;

    if (body.data.type === "TOKEN_AMOUNT") {
      data = {
        type: RuleType.TOKEN_AMOUNT,
        mint: body.data.mint.trim(),
        collection: null,
        thresholdAmount: new Prisma.Decimal(body.data.amount),
        thresholdUsd: null,
        thresholdCount: null,
        roleId: body.data.role_id,
        priceSource: null,
        priceAssetId: null,
        createdByDiscordUserId: session.discordUserId
      };
    } else if (body.data.type === "TOKEN_USD") {
      data = {
        type: RuleType.TOKEN_USD,
        mint: body.data.mint.trim(),
        collection: null,
        thresholdAmount: null,
        thresholdUsd: new Prisma.Decimal(body.data.usd),
        thresholdCount: null,
        roleId: body.data.role_id,
        priceSource: PriceSource.COINGECKO,
        priceAssetId: body.data.coingecko_id.trim(),
        createdByDiscordUserId: session.discordUserId
      };
    } else {
      data = {
        type: RuleType.NFT_COLLECTION,
        mint: null,
        collection: body.data.collection.trim(),
        thresholdAmount: null,
        thresholdUsd: null,
        thresholdCount: body.data.count,
        roleId: body.data.role_id,
        priceSource: null,
        priceAssetId: null,
        createdByDiscordUserId: session.discordUserId
      };
    }

    if (typeof body.data.enabled === "boolean") {
      data.enabled = body.data.enabled;
    }

    const updated = await prisma.gatingRule.updateMany({
      where: {
        guildId: ids.guildId,
        id: ids.ruleId
      },
      data
    });

    if (updated.count === 0) {
      return reply.status(404).send({ error: "rule_not_found" });
    }

    const rule = await prisma.gatingRule.findUnique({ where: { id: ids.ruleId } });
    if (!rule) {
      return reply.status(404).send({ error: "rule_not_found" });
    }

    await worker.enqueueRecheck(ids.guildId);

    return reply.send({ item: serializeRule(rule) });
  });

  app.delete("/admin/api/guilds/:guildId/rules/:ruleId", async (request, reply) => {
    const session = requireAdminSession(request, reply);
    if (!session) {
      return;
    }

    if (!assertValidOriginForMutation(request, reply)) {
      return;
    }

    const ids = parseGuildAndRuleIdOrReply(request, reply);
    if (!ids) {
      return;
    }

    if (!requireGuildAccess(session, ids.guildId, reply)) {
      return;
    }

    const result = await removeRule(ids.guildId, ids.ruleId);
    await worker.enqueueRecheck(ids.guildId);

    return reply.send({ deleted: result.count });
  });

  app.post("/admin/api/guilds/:guildId/recheck", async (request, reply) => {
    const session = requireAdminSession(request, reply);
    if (!session) {
      return;
    }

    if (!assertValidOriginForMutation(request, reply)) {
      return;
    }

    const guildId = parseGuildIdOrReply(request, reply);
    if (!guildId) {
      return;
    }

    if (!requireGuildAccess(session, guildId, reply)) {
      return;
    }

    const body = adminRecheckBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({ error: body.error.flatten() });
    }

    await worker.enqueueRecheck(guildId, body.data.discord_user_id);
    return reply.send({ ok: true });
  });

  app.get("/admin/api/guilds/:guildId/audit", async (request, reply) => {
    const session = requireAdminSession(request, reply);
    if (!session) {
      return;
    }

    const guildId = parseGuildIdOrReply(request, reply);
    if (!guildId) {
      return;
    }

    if (!requireGuildAccess(session, guildId, reply)) {
      return;
    }

    const query = auditQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.status(400).send({ error: query.error.flatten() });
    }

    const where: Prisma.AuditLogWhereInput = { guildId };

    if (query.data.action) {
      if (!Object.values(AuditAction).includes(query.data.action as AuditAction)) {
        return reply.status(400).send({ error: "invalid_action" });
      }

      where.action = query.data.action as AuditAction;
    }

    if (query.data.discord_user_id) {
      where.discordUserId = query.data.discord_user_id;
    }

    if (query.data.date_from || query.data.date_to) {
      const timestampFilter: Prisma.DateTimeFilter = {};

      if (query.data.date_from) {
        timestampFilter.gte = new Date(query.data.date_from);
      }

      if (query.data.date_to) {
        timestampFilter.lte = new Date(query.data.date_to);
      }

      where.timestamp = timestampFilter;
    }

    const skip = (query.data.page - 1) * query.data.limit;

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip,
        take: query.data.limit
      })
    ]);

    return reply.send({
      page: query.data.page,
      limit: query.data.limit,
      total,
      items: items.map((item) => ({
        id: item.id,
        timestamp: item.timestamp.toISOString(),
        guild_id: item.guildId,
        discord_user_id: item.discordUserId,
        rule_id: item.ruleId,
        role_id: item.roleId,
        action: item.action,
        reason: item.reason
      }))
    });
  });

  const serveAdminIndex = async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!hasAdminBuild) {
      return reply.type("text/html").send(adminBuildMissingHtml());
    }

    return reply.type("text/html").sendFile("index.html");
  };

  app.get("/admin", serveAdminIndex);
  app.get("/admin/*", serveAdminIndex);

  app.setErrorHandler((error, _request, reply) => {
    logger.error("API unhandled error", error);
    void reply.status(500).send({ error: "internal_error" });
  });

  return app;
}
