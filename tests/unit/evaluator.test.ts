import { describe, expect, it } from "vitest";
import { RuleType } from "@prisma/client";
import { computeRoleDecisions, evaluateRules } from "../../src/rules/evaluator";

function makeRule(partial: Record<string, unknown>) {
  return {
    id: "rule-id",
    guildId: "guild-1",
    type: RuleType.TOKEN_AMOUNT,
    mint: null,
    collection: null,
    thresholdAmount: null,
    thresholdUsd: null,
    thresholdCount: null,
    roleId: "role-1",
    priceSource: null,
    priceAssetId: null,
    enabled: true,
    createdByDiscordUserId: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial
  } as any;
}

describe("rules evaluator", () => {
  it("marks TOKEN_AMOUNT as satisfied when balance equals threshold", () => {
    const rules = [
      makeRule({
        id: "r1",
        type: RuleType.TOKEN_AMOUNT,
        mint: "mint-a",
        thresholdAmount: "100"
      })
    ];

    const snapshot = {
      wallet: "wallet-a",
      tokenBalancesByMint: new Map([["mint-a", 100]]),
      nftCountsByCollection: new Map()
    };

    const results = evaluateRules({
      rules,
      snapshot,
      pricesUsdByAssetId: new Map()
    });

    expect(results[0].satisfied).toBe(true);
  });

  it("marks TOKEN_USD as indeterminate when price is missing", () => {
    const rules = [
      makeRule({
        id: "r-usd",
        type: RuleType.TOKEN_USD,
        mint: "mint-usd",
        thresholdUsd: "10",
        priceAssetId: "asset-x"
      })
    ];

    const snapshot = {
      wallet: "wallet-a",
      tokenBalancesByMint: new Map([["mint-usd", 5]]),
      nftCountsByCollection: new Map()
    };

    const results = evaluateRules({
      rules,
      snapshot,
      pricesUsdByAssetId: new Map()
    });

    expect(results[0].satisfied).toBeNull();
  });

  it("evaluates NFT collection count", () => {
    const rules = [
      makeRule({
        id: "r-nft",
        type: RuleType.NFT_COLLECTION,
        collection: "col-1",
        thresholdCount: 2
      })
    ];

    const snapshot = {
      wallet: "wallet-a",
      tokenBalancesByMint: new Map(),
      nftCountsByCollection: new Map([["col-1", 2]])
    };

    const results = evaluateRules({
      rules,
      snapshot,
      pricesUsdByAssetId: new Map()
    });

    expect(results[0].satisfied).toBe(true);
  });

  it("applies OR role logic and fail-open", () => {
    const decisions = computeRoleDecisions([
      {
        ruleId: "r1",
        roleId: "role-1",
        satisfied: false,
        reason: "false"
      },
      {
        ruleId: "r2",
        roleId: "role-1",
        satisfied: null,
        reason: "indeterminate"
      },
      {
        ruleId: "r3",
        roleId: "role-2",
        satisfied: true,
        reason: "true"
      }
    ]);

    const role1 = decisions.find((d) => d.roleId === "role-1");
    const role2 = decisions.find((d) => d.roleId === "role-2");

    expect(role1?.shouldHave).toBeNull();
    expect(role2?.shouldHave).toBe(true);
  });
});
