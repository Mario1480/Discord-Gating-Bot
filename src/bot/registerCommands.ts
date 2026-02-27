import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v10";
import { env } from "../config/env";
import { commandDefinitions } from "./commandDefinitions";

async function main(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  if (env.discordGuildIds.length > 0) {
    // Prevent duplicate slash entries when old global commands still exist.
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
      body: []
    });
    console.log("Cleared global commands");

    for (const guildId of env.discordGuildIds) {
      await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, guildId), {
        body: commandDefinitions
      });
      console.log(`Registered commands for guild ${guildId}`);
    }
    return;
  }

  await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), {
    body: commandDefinitions
  });
  console.log("Registered global commands");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
