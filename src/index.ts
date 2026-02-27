import { env } from "./config/env";
import { prisma } from "./db/client";
import { buildApiServer } from "./api/server";
import { createDiscordClient } from "./bot/client";
import { logger } from "./utils/logger";
import { GatingWorker } from "./worker/gatingWorker";

async function main(): Promise<void> {
  const workerRef: { current?: GatingWorker } = {};
  const discordClient = createDiscordClient(workerRef);
  const worker = new GatingWorker(discordClient);
  workerRef.current = worker;

  const apiServer = buildApiServer(worker, discordClient);

  await prisma.$connect();
  await discordClient.login(env.DISCORD_TOKEN);

  await apiServer.listen({ port: env.PORT, host: "0.0.0.0" });
  worker.start();

  logger.info("Service started", { port: env.PORT });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Shutdown started (${signal})`);

    await apiServer.close().catch((error) => {
      logger.error("API shutdown failed", error);
    });

    await discordClient.destroy();

    await prisma.$disconnect().catch((error) => {
      logger.error("DB disconnect failed", error);
    });

    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch(async (error) => {
  logger.error("Fatal bootstrap error", error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
