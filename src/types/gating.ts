export type RuleType = "TOKEN_AMOUNT" | "TOKEN_USD" | "NFT_COLLECTION";

export type EvaluationResult = {
  ruleId: string;
  roleId: string;
  satisfied: boolean | null;
  reason: string;
};

export type WalletSnapshot = {
  wallet: string;
  tokenBalancesByMint: Map<string, number>;
  nftCountsByCollection: Map<string, number>;
};

export type RoleDecision = {
  roleId: string;
  shouldHave: boolean | null;
  matchedRuleIds: string[];
};
