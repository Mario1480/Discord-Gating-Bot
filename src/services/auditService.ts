import { AuditAction } from "@prisma/client";
import { prisma } from "../db/client";

export async function writeAuditLog(input: {
  guildId: string;
  discordUserId: string;
  roleId: string;
  action: AuditAction;
  reason: string;
  ruleId?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      roleId: input.roleId,
      action: input.action,
      reason: input.reason,
      ruleId: input.ruleId ?? null
    }
  });
}
