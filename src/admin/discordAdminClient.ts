import { Client, PermissionFlagsBits } from "discord.js";
import { AdminGuildSummary } from "../types/admin";

export type DiscordOAuthGuild = {
  id: string;
  name: string;
  icon: string | null;
  permissions: string;
};

export type AdminRoleSummary = {
  id: string;
  name: string;
  position: number;
  managed: boolean;
  mentionable: boolean;
  bot_can_manage: boolean;
};

export function hasManageGuildPermission(permissions: string): boolean {
  try {
    return (BigInt(permissions) & PermissionFlagsBits.ManageGuild) !== 0n;
  } catch {
    return false;
  }
}

export function filterAccessibleGuildsForAdmin(
  oauthGuilds: DiscordOAuthGuild[],
  botGuildIds: Set<string>
): AdminGuildSummary[] {
  return oauthGuilds
    .filter((guild) => hasManageGuildPermission(guild.permissions) && botGuildIds.has(guild.id))
    .map((guild) => ({ id: guild.id, name: guild.name, icon: guild.icon }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export class DiscordAdminClient {
  constructor(private readonly discordClient: Client) {}

  getBotGuildIds(): Set<string> {
    return new Set(this.discordClient.guilds.cache.map((guild) => guild.id));
  }

  async listGuildRoles(guildId: string): Promise<AdminRoleSummary[]> {
    const guild = await this.discordClient.guilds.fetch(guildId);
    await guild.members.fetchMe();

    const roles = await guild.roles.fetch();

    return roles
      .filter((role) => role.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({
        id: role.id,
        name: role.name,
        position: role.position,
        managed: role.managed,
        mentionable: role.mentionable,
        bot_can_manage: role.editable
      }));
  }
}
