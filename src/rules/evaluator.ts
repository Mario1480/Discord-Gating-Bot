import { GatingRule, RuleType } from "@prisma/client";
import { EvaluationResult, RoleDecision, WalletSnapshot } from "../types/gating";

export function evaluateRules(input: {
  rules: GatingRule[];
  snapshot: WalletSnapshot;
  pricesUsdByAssetId: Map<string, number>;
}): EvaluationResult[] {
  return input.rules.map((rule) => evaluateRule(rule, input.snapshot, input.pricesUsdByAssetId));
}

function evaluateRule(
  rule: GatingRule,
  snapshot: WalletSnapshot,
  pricesUsdByAssetId: Map<string, number>
): EvaluationResult {
  if (rule.type === RuleType.TOKEN_AMOUNT) {
    const threshold = Number(rule.thresholdAmount ?? 0);
    const mint = rule.mint ?? "";
    const balance = snapshot.tokenBalancesByMint.get(mint) ?? 0;
    const satisfied = balance >= threshold;

    return {
      ruleId: rule.id,
      roleId: rule.roleId,
      satisfied,
      reason: `TOKEN_AMOUNT balance=${balance} threshold=${threshold} mint=${mint}`
    };
  }

  if (rule.type === RuleType.TOKEN_USD) {
    const thresholdUsd = Number(rule.thresholdUsd ?? 0);
    const mint = rule.mint ?? "";
    const balance = snapshot.tokenBalancesByMint.get(mint) ?? 0;
    const assetId = rule.priceAssetId ?? "";

    const price = pricesUsdByAssetId.get(assetId);
    if (price === undefined) {
      return {
        ruleId: rule.id,
        roleId: rule.roleId,
        satisfied: null,
        reason: `TOKEN_USD indeterminate missing price asset=${assetId}`
      };
    }

    const valueUsd = balance * price;
    const satisfied = valueUsd >= thresholdUsd;

    return {
      ruleId: rule.id,
      roleId: rule.roleId,
      satisfied,
      reason: `TOKEN_USD balance=${balance} price=${price} value=${valueUsd} threshold=${thresholdUsd} mint=${mint}`
    };
  }

  const thresholdCount = Number(rule.thresholdCount ?? 0);
  const collection = rule.collection ?? "";
  const count = snapshot.nftCountsByCollection.get(collection) ?? 0;
  const satisfied = count >= thresholdCount;

  return {
    ruleId: rule.id,
    roleId: rule.roleId,
    satisfied,
    reason: `NFT_COLLECTION count=${count} threshold=${thresholdCount} collection=${collection}`
  };
}

export function computeRoleDecisions(evaluations: EvaluationResult[]): RoleDecision[] {
  const byRole = new Map<string, EvaluationResult[]>();

  for (const evaluation of evaluations) {
    const list = byRole.get(evaluation.roleId) ?? [];
    list.push(evaluation);
    byRole.set(evaluation.roleId, list);
  }

  const decisions: RoleDecision[] = [];

  for (const [roleId, evals] of byRole.entries()) {
    const hasTrue = evals.some((e) => e.satisfied === true);
    const hasNull = evals.some((e) => e.satisfied === null);

    let shouldHave: boolean | null;
    if (hasTrue) {
      shouldHave = true;
    } else if (hasNull) {
      shouldHave = null;
    } else {
      shouldHave = false;
    }

    decisions.push({
      roleId,
      shouldHave,
      matchedRuleIds: evals.filter((e) => e.satisfied === true).map((e) => e.ruleId)
    });
  }

  return decisions;
}
