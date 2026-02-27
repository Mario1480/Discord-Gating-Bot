import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  GuildMember,
  Interaction,
  PermissionFlagsBits
} from "discord.js";
import {
  addNftCollectionRule,
  addTokenAmountRule,
  addTokenUsdRule,
  listGuildRules,
  removeRule,
  setRuleEnabled
} from "../services/ruleService";
import { createVerifySession, unlinkWallet } from "../services/verifyService";
import { logger } from "../utils/logger";
import { GatingWorker } from "../worker/gatingWorker";

const VERIFY_PANEL_BUTTON_ID = "verify_panel_start";

function isGuildAdmin(interaction: ChatInputCommandInteraction): boolean {
  const member = interaction.member as GuildMember | null;
  return Boolean(member?.permissions.has(PermissionFlagsBits.ManageGuild));
}

function formatRule(rule: {
  id: string;
  type: string;
  roleId: string;
  mint: string | null;
  collection: string | null;
  thresholdAmount: unknown;
  thresholdUsd: unknown;
  thresholdCount: number | null;
  enabled: boolean;
}): string {
  if (rule.type === "TOKEN_AMOUNT") {
    return `${rule.enabled ? "ON" : "OFF"} ${rule.id} TOKEN_AMOUNT mint=${rule.mint} amount=${rule.thresholdAmount} role=<@&${rule.roleId}>`;
  }

  if (rule.type === "TOKEN_USD") {
    return `${rule.enabled ? "ON" : "OFF"} ${rule.id} TOKEN_USD mint=${rule.mint} usd=${rule.thresholdUsd} role=<@&${rule.roleId}>`;
  }

  return `${rule.enabled ? "ON" : "OFF"} ${rule.id} NFT_COLLECTION collection=${rule.collection} count=${rule.thresholdCount} role=<@&${rule.roleId}>`;
}

async function handleVerify(interaction: ChatInputCommandInteraction): Promise<void> {
  await replyWithVerifySession(interaction);
}

async function replyWithVerifySession(
  interaction: ChatInputCommandInteraction | ButtonInteraction
): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: "This command must be used in a server.", ephemeral: true });
    return;
  }

  const session = await createVerifySession({
    guildId,
    discordUserId: interaction.user.id
  });

  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(session.verifyUrl).setLabel("Connect Wallet")
  );

  await interaction.reply({
    content: `Open your personal verify link (expires ${session.expiresAt.toISOString()}).`,
    components: [actionRow],
    ephemeral: true
  });
}

export function createDiscordClient(workerRef: { current?: GatingWorker }): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });

  client.once("ready", () => {
    logger.info(`Discord bot ready as ${client.user?.tag ?? "unknown"}`);
  });

  client.on("interactionCreate", async (interaction: Interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === VERIFY_PANEL_BUTTON_ID) {
        await replyWithVerifySession(interaction);
        return;
      }

      if (!interaction.isChatInputCommand()) {
        return;
      }

      if (interaction.commandName === "verify") {
        await handleVerify(interaction);
        return;
      }

      if (interaction.commandName === "unlink") {
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.reply({ content: "This command must be used in a server.", ephemeral: true });
          return;
        }

        const result = await unlinkWallet({ guildId, discordUserId: interaction.user.id });
        if (result.deleted && workerRef.current) {
          await workerRef.current.removeManagedRolesForMember(guildId, interaction.user.id);
        }

        await interaction.reply({
          content: result.deleted
            ? `Wallet ${result.wallet} unlinked and managed roles removed.`
            : "No wallet link found.",
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName !== "gating") {
        return;
      }

      if (!isGuildAdmin(interaction)) {
        await interaction.reply({ content: "Manage Server permission required.", ephemeral: true });
        return;
      }

      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ content: "This command must be used in a server.", ephemeral: true });
        return;
      }

      const sub = interaction.options.getSubcommand();

      if (sub === "add-token-amount") {
        const mint = interaction.options.getString("mint", true);
        const amount = interaction.options.getNumber("amount", true);
        const role = interaction.options.getRole("role", true);

        const rule = await addTokenAmountRule({
          guildId,
          createdByDiscordUserId: interaction.user.id,
          mint,
          amount,
          roleId: role.id
        });

        if (workerRef.current) {
          await workerRef.current.enqueueRecheck(guildId);
        }

        await interaction.reply({ content: `Rule added: ${rule.id}`, ephemeral: true });
        return;
      }

      if (sub === "add-token-usd") {
        const mint = interaction.options.getString("mint", true);
        const usd = interaction.options.getNumber("usd", true);
        const role = interaction.options.getRole("role", true);
        const coingeckoId = interaction.options.getString("coingecko_id", true);

        const rule = await addTokenUsdRule({
          guildId,
          createdByDiscordUserId: interaction.user.id,
          mint,
          usd,
          roleId: role.id,
          priceAssetId: coingeckoId
        });

        if (workerRef.current) {
          await workerRef.current.enqueueRecheck(guildId);
        }

        await interaction.reply({ content: `Rule added: ${rule.id}`, ephemeral: true });
        return;
      }

      if (sub === "add-nft-collection") {
        const collection = interaction.options.getString("collection", true);
        const count = interaction.options.getInteger("count", true);
        const role = interaction.options.getRole("role", true);

        const rule = await addNftCollectionRule({
          guildId,
          createdByDiscordUserId: interaction.user.id,
          collection,
          count,
          roleId: role.id
        });

        if (workerRef.current) {
          await workerRef.current.enqueueRecheck(guildId);
        }

        await interaction.reply({ content: `Rule added: ${rule.id}`, ephemeral: true });
        return;
      }

      if (sub === "list") {
        const rules = await listGuildRules(guildId);

        if (rules.length === 0) {
          await interaction.reply({ content: "No gating rules configured.", ephemeral: true });
          return;
        }

        const lines = rules.map((rule) => formatRule(rule));
        await interaction.reply({ content: lines.join("\n"), ephemeral: true });
        return;
      }

      if (sub === "remove") {
        const ruleId = interaction.options.getString("rule_id", true);
        const result = await removeRule(guildId, ruleId);

        if (workerRef.current) {
          await workerRef.current.enqueueRecheck(guildId);
        }

        await interaction.reply({ content: `Removed rules: ${result.count}`, ephemeral: true });
        return;
      }

      if (sub === "enable" || sub === "disable") {
        const ruleId = interaction.options.getString("rule_id", true);
        const enabled = sub === "enable";
        const result = await setRuleEnabled(guildId, ruleId, enabled);

        if (workerRef.current) {
          await workerRef.current.enqueueRecheck(guildId);
        }

        await interaction.reply({
          content: `${enabled ? "Enabled" : "Disabled"} rules: ${result.count}`,
          ephemeral: true
        });
        return;
      }

      if (sub === "run-now") {
        if (!workerRef.current) {
          await interaction.reply({ content: "Worker not initialized.", ephemeral: true });
          return;
        }

        const user = interaction.options.getUser("user", false);
        await workerRef.current.enqueueRecheck(guildId, user?.id);

        await interaction.reply({
          content: user ? `Queued recheck for ${user.tag}` : "Queued recheck for full guild.",
          ephemeral: true
        });
        return;
      }

      if (sub === "post-verify-panel") {
        const channel = interaction.channel;
        if (!channel || !channel.isTextBased() || !("send" in channel)) {
          await interaction.reply({ content: "Cannot post panel in this channel.", ephemeral: true });
          return;
        }

        const title = interaction.options.getString("title", false) ?? "Verify your assets";
        const requirement =
          interaction.options.getString("requirement", false) ??
          "Click the button below to connect and verify your Solana wallet.";

        const embed = new EmbedBuilder()
          .setColor(0x4f46e5)
          .setTitle(title)
          .setDescription(
            `${requirement}\n\n` +
              "This is a read-only signature check. Never share your seed phrase or private keys."
          );

        const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(VERIFY_PANEL_BUTTON_ID)
            .setLabel("Let's go!")
            .setStyle(ButtonStyle.Primary)
        );

        await channel.send({
          embeds: [embed],
          components: [buttonRow]
        });

        await interaction.reply({
          content: "Verification panel posted.",
          ephemeral: true
        });
        return;
      }

      await interaction.reply({
        content: `Unknown gating subcommand: ${sub}`,
        ephemeral: true
      });
    } catch (error) {
      logger.error("Interaction handler failed", error);
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: "Command failed. Check logs.", ephemeral: true }).catch(() => undefined);
        } else {
          await interaction.reply({ content: "Command failed. Check logs.", ephemeral: true }).catch(() => undefined);
        }
      }
    }
  });

  return client;
}
