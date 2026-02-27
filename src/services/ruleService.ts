import { PriceSource, Prisma, RuleType } from "@prisma/client";
import { prisma } from "../db/client";
import { ensureGuild } from "./guildService";

export async function addTokenAmountRule(input: {
  guildId: string;
  createdByDiscordUserId: string;
  mint: string;
  amount: number;
  roleId: string;
}) {
  await ensureGuild(input.guildId);
  const mint = input.mint.trim();

  return prisma.gatingRule.create({
    data: {
      guildId: input.guildId,
      createdByDiscordUserId: input.createdByDiscordUserId,
      type: RuleType.TOKEN_AMOUNT,
      mint,
      thresholdAmount: new Prisma.Decimal(input.amount),
      roleId: input.roleId,
      enabled: true
    }
  });
}

export async function addTokenUsdRule(input: {
  guildId: string;
  createdByDiscordUserId: string;
  mint: string;
  usd: number;
  roleId: string;
  priceAssetId: string;
}) {
  await ensureGuild(input.guildId);
  const mint = input.mint.trim();
  const priceAssetId = input.priceAssetId.trim();

  return prisma.gatingRule.create({
    data: {
      guildId: input.guildId,
      createdByDiscordUserId: input.createdByDiscordUserId,
      type: RuleType.TOKEN_USD,
      mint,
      thresholdUsd: new Prisma.Decimal(input.usd),
      roleId: input.roleId,
      priceSource: PriceSource.COINGECKO,
      priceAssetId,
      enabled: true
    }
  });
}

export async function addNftCollectionRule(input: {
  guildId: string;
  createdByDiscordUserId: string;
  collection: string;
  count: number;
  roleId: string;
}) {
  await ensureGuild(input.guildId);
  const collection = input.collection.trim();

  return prisma.gatingRule.create({
    data: {
      guildId: input.guildId,
      createdByDiscordUserId: input.createdByDiscordUserId,
      type: RuleType.NFT_COLLECTION,
      collection,
      thresholdCount: input.count,
      roleId: input.roleId,
      enabled: true
    }
  });
}

export async function listGuildRules(guildId: string) {
  return prisma.gatingRule.findMany({
    where: { guildId },
    orderBy: [{ enabled: "desc" }, { createdAt: "asc" }]
  });
}

export async function removeRule(guildId: string, ruleId: string) {
  return prisma.gatingRule.deleteMany({
    where: { guildId, id: ruleId }
  });
}

export async function setRuleEnabled(guildId: string, ruleId: string, enabled: boolean) {
  return prisma.gatingRule.updateMany({
    where: { guildId, id: ruleId },
    data: { enabled }
  });
}

export async function getActiveRulesByGuild(guildId: string) {
  return prisma.gatingRule.findMany({
    where: {
      guildId,
      enabled: true
    }
  });
}

export async function getActiveRulesGroupedByGuild() {
  const rules = await prisma.gatingRule.findMany({ where: { enabled: true } });
  const byGuild = new Map<string, typeof rules>();

  for (const rule of rules) {
    const list = byGuild.get(rule.guildId) ?? [];
    list.push(rule);
    byGuild.set(rule.guildId, list);
  }

  return byGuild;
}
