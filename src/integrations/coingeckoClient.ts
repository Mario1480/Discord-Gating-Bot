import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";

export class CoinGeckoClient {
  constructor(private readonly ttlSeconds = 60) {}

  async getUsdPrices(assetIds: string[]): Promise<Map<string, number>> {
    const uniqueIds = [...new Set(assetIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const now = new Date();
    const ttlStart = new Date(now.getTime() - this.ttlSeconds * 1000);

    const cached = await prisma.priceCache.findMany({
      where: {
        assetId: { in: uniqueIds },
        fetchedAt: { gte: ttlStart }
      }
    });

    const result = new Map<string, number>();
    for (const row of cached) {
      result.set(row.assetId, Number(row.priceUsd));
    }

    const missing = uniqueIds.filter((id) => !result.has(id));
    if (missing.length === 0) {
      return result;
    }

    const url = new URL(`${env.COINGECKO_BASE_URL}/simple/price`);
    url.searchParams.set("ids", missing.join(","));
    url.searchParams.set("vs_currencies", "usd");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`CoinGecko request failed with status ${response.status}`);
    }

    const json = (await response.json()) as Record<string, { usd?: number }>;

    const updates: Prisma.PriceCacheCreateManyInput[] = [];

    for (const id of missing) {
      const price = json[id]?.usd;
      if (typeof price !== "number" || !Number.isFinite(price)) {
        logger.warn("Missing CoinGecko price for asset", { assetId: id });
        continue;
      }

      result.set(id, price);
      updates.push({
        assetId: id,
        priceUsd: new Prisma.Decimal(price),
        fetchedAt: now
      });
    }

    if (updates.length > 0) {
      for (const update of updates) {
        await prisma.priceCache.upsert({
          where: { assetId: update.assetId },
          create: update,
          update: {
            priceUsd: update.priceUsd,
            fetchedAt: update.fetchedAt
          }
        });
      }
    }

    return result;
  }
}
