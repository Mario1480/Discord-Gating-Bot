import { PermissionFlagsBits, SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Create a wallet verification challenge link"),
  new SlashCommandBuilder()
    .setName("unlink")
    .setDescription("Unlink your verified wallet and remove managed roles"),
  new SlashCommandBuilder()
    .setName("gating")
    .setDescription("Manage token/NFT role gating rules")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add-token-amount")
        .setDescription("Add TOKEN_AMOUNT rule")
        .addStringOption((opt) => opt.setName("mint").setDescription("Token mint address").setRequired(true))
        .addNumberOption((opt) => opt.setName("amount").setDescription("Minimum token amount").setRequired(true))
        .addRoleOption((opt) => opt.setName("role").setDescription("Discord role").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add-token-usd")
        .setDescription("Add TOKEN_USD rule")
        .addStringOption((opt) => opt.setName("mint").setDescription("Token mint address").setRequired(true))
        .addNumberOption((opt) => opt.setName("usd").setDescription("Minimum USD value").setRequired(true))
        .addRoleOption((opt) => opt.setName("role").setDescription("Discord role").setRequired(true))
        .addStringOption((opt) =>
          opt.setName("coingecko_id").setDescription("CoinGecko asset id (e.g. solana)").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add-nft-collection")
        .setDescription("Add NFT_COLLECTION rule")
        .addStringOption((opt) =>
          opt.setName("collection").setDescription("Verified collection address").setRequired(true)
        )
        .addIntegerOption((opt) => opt.setName("count").setDescription("Minimum NFT count").setRequired(true))
        .addRoleOption((opt) => opt.setName("role").setDescription("Discord role").setRequired(true))
    )
    .addSubcommand((subcommand) => subcommand.setName("list").setDescription("List gating rules"))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a rule")
        .addStringOption((opt) => opt.setName("rule_id").setDescription("Rule UUID").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("enable")
        .setDescription("Enable a rule")
        .addStringOption((opt) => opt.setName("rule_id").setDescription("Rule UUID").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("disable")
        .setDescription("Disable a rule")
        .addStringOption((opt) => opt.setName("rule_id").setDescription("Rule UUID").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("run-now")
        .setDescription("Run a check now")
        .addUserOption((opt) => opt.setName("user").setDescription("Optional user").setRequired(false))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("post-verify-panel")
        .setDescription("Post a verification panel in this channel")
        .addStringOption((opt) =>
          opt
            .setName("title")
            .setDescription("Optional panel title (e.g. Verify your assets)")
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName("requirement")
            .setDescription("Optional requirement text shown below the title")
            .setRequired(false)
        )
    )
].map((command) => command.toJSON());
