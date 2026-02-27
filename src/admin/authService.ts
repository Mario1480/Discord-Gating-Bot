import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { Client } from "discord.js";
import { env } from "../config/env";
import { prisma } from "../db/client";
import { AdminSession } from "../types/admin";
import { DiscordAdminClient, DiscordOAuthGuild, filterAccessibleGuildsForAdmin } from "./discordAdminClient";

const DISCORD_API_BASE = "https://discord.com/api/v10";
const ADMIN_SESSION_COOKIE_NAME = "admin_session";

type DiscordOAuthTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
};

type DiscordOAuthUserResponse = {
  id: string;
  username: string;
  avatar: string | null;
};

function sanitizeRedirectPath(input?: string): string {
  if (!input || !input.startsWith("/admin")) {
    return "/admin";
  }
  return input;
}

function parseSessionToken(token: string): AdminSession {
  const decoded = jwt.verify(token, env.ADMIN_SESSION_SECRET, { algorithms: ["HS256"] });
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Invalid admin session token");
  }

  const discordUserId = decoded.discordUserId;
  const username = decoded.username;
  const avatar = decoded.avatar;
  const guilds = decoded.guilds;

  if (!discordUserId || !username || !Array.isArray(guilds)) {
    throw new Error("Invalid admin session payload");
  }

  return {
    discordUserId,
    username,
    avatar: typeof avatar === "string" ? avatar : null,
    guilds: guilds.map((guild) => ({
      id: String(guild.id),
      name: String(guild.name),
      icon: guild.icon ? String(guild.icon) : null
    }))
  };
}

async function exchangeCodeForToken(code: string): Promise<DiscordOAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: env.adminCallbackUrl
  });

  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Discord token exchange failed (${response.status})`);
  }

  return payload as DiscordOAuthTokenResponse;
}

async function fetchDiscordOAuthData(accessToken: string): Promise<{
  user: DiscordOAuthUserResponse;
  guilds: DiscordOAuthGuild[];
}> {
  const headers = {
    authorization: `Bearer ${accessToken}`
  };

  const [userResponse, guildsResponse] = await Promise.all([
    fetch(`${DISCORD_API_BASE}/users/@me`, { headers }),
    fetch(`${DISCORD_API_BASE}/users/@me/guilds`, { headers })
  ]);

  if (!userResponse.ok || !guildsResponse.ok) {
    throw new Error("Discord profile fetch failed");
  }

  const user = (await userResponse.json()) as DiscordOAuthUserResponse;
  const guilds = (await guildsResponse.json()) as DiscordOAuthGuild[];

  return { user, guilds };
}

export function getAdminSessionCookieName(): string {
  return ADMIN_SESSION_COOKIE_NAME;
}

export function makeAdminSessionCookie(token: string): string {
  const secure = env.NODE_ENV === "production" ? "Secure; " : "";
  const maxAge = env.ADMIN_SESSION_TTL_HOURS * 60 * 60;

  return `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; ${secure}Max-Age=${maxAge}`;
}

export function clearAdminSessionCookie(): string {
  const secure = env.NODE_ENV === "production" ? "Secure; " : "";
  return `${ADMIN_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; ${secure}Max-Age=0`;
}

export function decodeAdminSessionToken(token: string): AdminSession {
  return parseSessionToken(token);
}

export async function startDiscordOAuthLogin(input?: { redirectPath?: string }): Promise<string> {
  const state = randomBytes(24).toString("hex");
  const nonce = randomBytes(24).toString("hex");
  const redirectPath = sanitizeRedirectPath(input?.redirectPath);
  const expiresAt = new Date(Date.now() + 10 * 60_000);

  await prisma.oauthState.create({
    data: {
      state,
      nonce,
      redirectPath,
      expiresAt
    }
  });

  const authorizeUrl = new URL("https://discord.com/api/oauth2/authorize");
  authorizeUrl.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", env.adminCallbackUrl);
  authorizeUrl.searchParams.set("scope", env.DISCORD_OAUTH_SCOPES);
  authorizeUrl.searchParams.set("state", state);

  return authorizeUrl.toString();
}

export async function completeDiscordOAuthCallback(input: {
  code: string;
  state: string;
  discordClient: Client;
}): Promise<{
  sessionToken: string;
  redirectPath: string;
  session: AdminSession;
}> {
  const oauthState = await prisma.oauthState.findUnique({ where: { state: input.state } });

  if (!oauthState) {
    throw new Error("Invalid OAuth state");
  }

  if (oauthState.usedAt) {
    throw new Error("OAuth state already used");
  }

  if (oauthState.expiresAt.getTime() < Date.now()) {
    throw new Error("OAuth state expired");
  }

  await prisma.oauthState.update({
    where: { state: input.state },
    data: { usedAt: new Date() }
  });

  const token = await exchangeCodeForToken(input.code);
  const oauthData = await fetchDiscordOAuthData(token.access_token);

  const discordAdminClient = new DiscordAdminClient(input.discordClient);
  const accessibleGuilds = filterAccessibleGuildsForAdmin(oauthData.guilds, discordAdminClient.getBotGuildIds());

  const session: AdminSession = {
    discordUserId: oauthData.user.id,
    username: oauthData.user.username,
    avatar: oauthData.user.avatar,
    guilds: accessibleGuilds
  };

  const sessionToken = jwt.sign(session, env.ADMIN_SESSION_SECRET, {
    algorithm: "HS256",
    expiresIn: `${env.ADMIN_SESSION_TTL_HOURS}h`,
    subject: oauthData.user.id
  });

  return {
    sessionToken,
    redirectPath: oauthState.redirectPath,
    session
  };
}

export async function cleanupOAuthStates(): Promise<number> {
  const result = await prisma.oauthState.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }]
    }
  });

  return result.count;
}
