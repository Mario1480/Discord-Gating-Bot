import { prisma } from "../db/client";

export async function ensureGuild(guildId: string): Promise<void> {
  await prisma.guild.upsert({
    where: { guildId },
    create: { guildId },
    update: {}
  });
}
