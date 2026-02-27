export type AdminGuildSummary = {
  id: string;
  name: string;
  icon: string | null;
};

export type AdminSession = {
  discordUserId: string;
  username: string;
  avatar: string | null;
  guilds: AdminGuildSummary[];
};

export type AdminRuleCreateInput =
  | {
      type: "TOKEN_AMOUNT";
      role_id: string;
      mint: string;
      amount: number;
    }
  | {
      type: "TOKEN_USD";
      role_id: string;
      mint: string;
      usd: number;
      coingecko_id: string;
    }
  | {
      type: "NFT_COLLECTION";
      role_id: string;
      collection: string;
      count: number;
    };

export type AdminRuleUpdateInput =
  | {
      type: "TOKEN_AMOUNT";
      role_id: string;
      mint: string;
      amount: number;
      enabled?: boolean;
    }
  | {
      type: "TOKEN_USD";
      role_id: string;
      mint: string;
      usd: number;
      coingecko_id: string;
      enabled?: boolean;
    }
  | {
      type: "NFT_COLLECTION";
      role_id: string;
      collection: string;
      count: number;
      enabled?: boolean;
    };

export type AdminAuditQuery = {
  page: number;
  limit: number;
  action?: string;
  discord_user_id?: string;
  date_from?: string;
  date_to?: string;
};

export type AdminAuditPage = {
  page: number;
  limit: number;
  total: number;
  items: Array<{
    id: string;
    timestamp: string;
    guild_id: string;
    discord_user_id: string;
    rule_id: string | null;
    role_id: string;
    action: string;
    reason: string;
  }>;
};

export type AdminRecheckInput = {
  discord_user_id?: string;
};
