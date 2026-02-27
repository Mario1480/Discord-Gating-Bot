import { AuditAction, GatingRule } from "@prisma/client";
import cron from "node-cron";
import { Client, Guild, GuildMember, PermissionFlagsBits, Role } from "discord.js";
import { env } from "../config/env";
import { prisma } from "../db/client";
import { CoinGeckoClient } from "../integrations/coingeckoClient";
import { computeRoleDecisions, evaluateRules } from "../rules/evaluator";
import { SolanaHoldingsService } from "../solana/holdingsService";
import { runWithConcurrency } from "../utils/concurrency";
import { logger } from "../utils/logger";
import { cleanupExpiredVerifySessions } from "../services/verifyService";
import { writeAuditLog } from "../services/auditService";

async function tryAcquireRunLock(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(42069, 777) AS locked
  `;

  return rows[0]?.locked === true;
}

async function releaseRunLock(): Promise<void> {
  await prisma.$executeRaw`
    SELECT pg_advisory_unlock(42069, 777)
  `;
}

function canManageRole(guild: Guild, role: Role): boolean {
  const botMember = guild.members.me;
  if (!botMember) {
    return false;
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return false;
  }

  return botMember.roles.highest.comparePositionTo(role) > 0;
}

export class GatingWorker {
  private readonly holdingsService = new SolanaHoldingsService();
  private readonly coingecko = new CoinGeckoClient(60);
  private readonly runNowQueue: Array<{ guildId: string; discordUserId?: string }> = [];
  private processingRunNow = false;

  constructor(private readonly discordClient: Client) {}

  start(): void {
    cron.schedule(env.POLL_CRON, async () => {
      await this.runScheduledCycle();
    });

    cron.schedule("0 3 * * *", async () => {
      await this.cleanupData();
    });

    logger.info("Gating worker started", {
      pollCron: env.POLL_CRON,
      concurrency: env.CHECK_CONCURRENCY
    });
  }

  async enqueueRecheck(guildId: string, discordUserId?: string): Promise<void> {
    this.runNowQueue.push({ guildId, discordUserId });
    if (this.processingRunNow) {
      return;
    }

    this.processingRunNow = true;
    try {
      while (this.runNowQueue.length > 0) {
        const next = this.runNowQueue.shift();
        if (!next) {
          continue;
        }

        if (next.discordUserId) {
          await this.runUserCheck(next.guildId, next.discordUserId);
        } else {
          await this.runGuildCheck(next.guildId);
        }
      }
    } finally {
      this.processingRunNow = false;
    }
  }

  async runScheduledCycle(): Promise<void> {
    const locked = await tryAcquireRunLock();
    if (!locked) {
      logger.warn("Skipping scheduled cycle: advisory lock not acquired");
      return;
    }

    try {
      logger.info("Scheduled gating cycle started");
      const guilds = await prisma.gatingRule.findMany({
        where: { enabled: true },
        distinct: ["guildId"],
        select: { guildId: true }
      });

      for (const { guildId } of guilds) {
        await this.runGuildCheck(guildId);
      }

      logger.info("Scheduled gating cycle completed", { guildCount: guilds.length });
    } catch (error) {
      logger.error("Scheduled gating cycle failed", error);
    } finally {
      await releaseRunLock();
    }
  }

  private async runGuildCheck(guildId: string): Promise<void> {
    const rules = await prisma.gatingRule.findMany({
      where: {
        guildId,
        enabled: true
      }
    });

    if (rules.length === 0) {
      return;
    }

    const walletLinks = await prisma.walletLink.findMany({
      where: { guildId },
      select: {
        discordUserId: true,
        walletPubkey: true
      }
    });

    await runWithConcurrency(
      walletLinks,
      env.CHECK_CONCURRENCY,
      async (walletLink) => this.runUserCheck(guildId, walletLink.discordUserId, rules)
    );
  }

  async runUserCheck(guildId: string, discordUserId: string, preloadedRules?: GatingRule[]): Promise<void> {
    const rules =
      preloadedRules ??
      (await prisma.gatingRule.findMany({
        where: { guildId, enabled: true }
      }));

    if (rules.length === 0) {
      return;
    }

    const walletLink = await prisma.walletLink.findUnique({
      where: {
        guildId_discordUserId: { guildId, discordUserId }
      }
    });

    if (!walletLink) {
      return;
    }

    const usdRuleAssetIds = rules
      .filter((rule) => rule.type === "TOKEN_USD")
      .map((rule) => rule.priceAssetId)
      .filter((value): value is string => Boolean(value));

    let prices = new Map<string, number>();
    try {
      prices = await this.coingecko.getUsdPrices(usdRuleAssetIds);
    } catch (error) {
      logger.warn("Price fetch failed; TOKEN_USD rules become indeterminate", {
        guildId,
        discordUserId,
        error
      });
    }

    const guild = await this.discordClient.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      logger.warn("Guild not found for run", { guildId });
      return;
    }

    await guild.members.fetchMe();

    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (!member) {
      logger.warn("Member not found in guild; skipping", { guildId, discordUserId });
      return;
    }

    const needsTokenSnapshot = rules.some((rule) => rule.type === "TOKEN_AMOUNT" || rule.type === "TOKEN_USD");
    const needsNftSnapshot = rules.some((rule) => rule.type === "NFT_COLLECTION");

    let snapshot;
    try {
      snapshot = await this.holdingsService.getWalletSnapshot(walletLink.walletPubkey, {
        includeTokenBalances: needsTokenSnapshot,
        includeNftCounts: needsNftSnapshot
      });
    } catch (error) {
      logger.warn("Wallet snapshot fetch failed; fail-open skip", {
        guildId,
        discordUserId,
        wallet: walletLink.walletPubkey,
        error
      });

      await prisma.walletLink.update({
        where: { id: walletLink.id },
        data: { lastCheckedAt: new Date() }
      });

      return;
    }

    const evaluations = evaluateRules({
      rules,
      snapshot,
      pricesUsdByAssetId: prices
    });
    const decisions = computeRoleDecisions(evaluations);

    for (const decision of decisions) {
      await this.syncRoleDecision({ guild, member, guildId, discordUserId, decision, evaluations });
    }

    await prisma.walletLink.update({
      where: { id: walletLink.id },
      data: { lastCheckedAt: new Date() }
    });
  }

  async removeManagedRolesForMember(guildId: string, discordUserId: string): Promise<void> {
    const guild = await this.discordClient.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      return;
    }

    await guild.members.fetchMe();
    const member = await guild.members.fetch(discordUserId).catch(() => null);
    if (!member) {
      return;
    }

    const managedRoles = await prisma.gatingRule.findMany({
      where: { guildId },
      distinct: ["roleId"],
      select: { roleId: true }
    });

    for (const { roleId } of managedRoles) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role || !member.roles.cache.has(roleId) || !canManageRole(guild, role)) {
        continue;
      }

      try {
        await member.roles.remove(roleId, "Wallet unlinked");
        await writeAuditLog({
          guildId,
          discordUserId,
          roleId,
          action: AuditAction.ROLE_REMOVED,
          reason: "wallet unlinked - removed managed role"
        });
      } catch (error) {
        logger.warn("Failed removing managed role on unlink", {
          guildId,
          discordUserId,
          roleId,
          error
        });
      }
    }
  }

  private async syncRoleDecision(input: {
    guild: Guild;
    member: GuildMember;
    guildId: string;
    discordUserId: string;
    decision: { roleId: string; shouldHave: boolean | null; matchedRuleIds: string[] };
    evaluations: Array<{ ruleId: string; roleId: string; satisfied: boolean | null; reason: string }>;
  }): Promise<void> {
    const { guild, member, guildId, discordUserId, decision, evaluations } = input;

    if (decision.shouldHave === null) {
      return;
    }

    const role = await guild.roles.fetch(decision.roleId).catch(() => null);
    if (!role) {
      logger.warn("Role not found for decision", { guildId, roleId: decision.roleId });
      return;
    }

    if (!canManageRole(guild, role)) {
      logger.warn("Bot cannot manage role", { guildId, roleId: decision.roleId });
      return;
    }

    const currentlyHasRole = member.roles.cache.has(decision.roleId);

    if (decision.shouldHave && !currentlyHasRole) {
      try {
        await member.roles.add(decision.roleId, "Gating rule satisfied");

        const matched = evaluations.find((e) => e.roleId === decision.roleId && e.satisfied === true);
        await writeAuditLog({
          guildId,
          discordUserId,
          roleId: decision.roleId,
          action: AuditAction.ROLE_ADDED,
          reason: matched?.reason ?? "role added by gating",
          ruleId: matched?.ruleId
        });
      } catch (error) {
        logger.warn("Role add failed", { guildId, discordUserId, roleId: decision.roleId, error });
      }
      return;
    }

    if (!decision.shouldHave && currentlyHasRole) {
      try {
        await member.roles.remove(decision.roleId, "Gating rule not satisfied");

        await writeAuditLog({
          guildId,
          discordUserId,
          roleId: decision.roleId,
          action: AuditAction.ROLE_REMOVED,
          reason: "no active rule satisfied for role"
        });
      } catch (error) {
        logger.warn("Role remove failed", { guildId, discordUserId, roleId: decision.roleId, error });
      }
    }
  }

  private async cleanupData(): Promise<void> {
    try {
      const deletedSessions = await cleanupExpiredVerifySessions();
      const deletedAudit = await prisma.auditLog.deleteMany({
        where: {
          timestamp: {
            lt: new Date(Date.now() - env.AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
          }
        }
      });

      logger.info("Cleanup complete", {
        deletedSessions,
        deletedAudit: deletedAudit.count
      });
    } catch (error) {
      logger.error("Cleanup failed", error);
    }
  }
}
