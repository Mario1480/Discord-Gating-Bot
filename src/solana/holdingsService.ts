import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { env } from "../config/env";
import { WalletSnapshot } from "../types/gating";
import { withRetry } from "../utils/async";

type DasAsset = {
  grouping?: Array<Record<string, unknown>>;
  content?: {
    metadata?: {
      collection?: {
        key?: string;
        verified?: boolean;
      };
    };
  };
};

type DasPageResponse = {
  result?: {
    items?: DasAsset[];
    total?: number;
    limit?: number;
    page?: number;
  };
};

function extractVerifiedCollectionAddress(asset: DasAsset): string | null {
  const grouping = Array.isArray(asset.grouping) ? asset.grouping : [];

  for (const group of grouping) {
    const key = group.group_key;
    const value = group.group_value;
    const verified = group.verified;

    if (
      key === "collection" &&
      typeof value === "string" &&
      (verified === true || group.collection_verified === true)
    ) {
      return value;
    }
  }

  const collection = asset.content?.metadata?.collection;
  if (collection?.verified && collection.key) {
    return collection.key;
  }

  return null;
}

export class SolanaHoldingsService {
  private readonly connection: Connection;

  constructor() {
    this.connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
  }

  async getWalletSnapshot(
    wallet: string,
    options?: {
      includeTokenBalances?: boolean;
      includeNftCounts?: boolean;
    }
  ): Promise<WalletSnapshot> {
    const includeTokenBalances = options?.includeTokenBalances ?? true;
    const includeNftCounts = options?.includeNftCounts ?? true;
    const owner = new PublicKey(wallet);
    const tokenBalancesByMint = includeTokenBalances ? await this.fetchTokenBalances(owner) : new Map<string, number>();
    const nftCountsByCollection = includeNftCounts
      ? await this.fetchNftCountsByCollection(wallet)
      : new Map<string, number>();

    return {
      wallet,
      tokenBalancesByMint,
      nftCountsByCollection
    };
  }

  private async fetchTokenBalances(owner: PublicKey): Promise<Map<string, number>> {
    const accounts = await withRetry(() =>
      this.connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID })
    );

    const balances = new Map<string, number>();

    for (const account of accounts.value) {
      const parsed = account.account.data.parsed;
      if (!parsed || parsed.type !== "account") {
        continue;
      }

      const info = parsed.info;
      const mint = info.mint as string;
      const uiAmount = Number(info.tokenAmount?.uiAmount ?? 0);
      const prev = balances.get(mint) ?? 0;
      balances.set(mint, prev + uiAmount);
    }

    return balances;
  }

  private async fetchNftCountsByCollection(owner: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();

    const limit = 1000;
    let page = 1;

    while (true) {
      const payload = {
        jsonrpc: "2.0",
        id: `assets-${owner}-${page}`,
        method: "getAssetsByOwner",
        params: {
          ownerAddress: owner,
          page,
          limit
        }
      };

      const data = await withRetry(async () => {
        const response = await fetch(env.SOLANA_DAS_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`DAS request failed with status ${response.status}`);
        }

        return (await response.json()) as DasPageResponse;
      });

      const items = data.result?.items ?? [];

      for (const item of items) {
        const collection = extractVerifiedCollectionAddress(item);
        if (!collection) {
          continue;
        }

        counts.set(collection, (counts.get(collection) ?? 0) + 1);
      }

      if (items.length < limit) {
        break;
      }

      page += 1;
    }

    return counts;
  }
}
