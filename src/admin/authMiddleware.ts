import { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env";
import { AdminSession } from "../types/admin";
import { decodeAdminSessionToken, getAdminSessionCookieName } from "./authService";

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return header
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, part) => {
      const index = part.indexOf("=");
      if (index <= 0) {
        return acc;
      }

      const key = part.slice(0, index).trim();
      const value = decodeURIComponent(part.slice(index + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

export function readAdminSessionFromRequest(request: FastifyRequest): AdminSession | null {
  const cookies = parseCookies(request.headers.cookie);
  const rawToken = cookies[getAdminSessionCookieName()];
  if (!rawToken) {
    return null;
  }

  try {
    return decodeAdminSessionToken(rawToken);
  } catch {
    return null;
  }
}

export function requireAdminSession(request: FastifyRequest, reply: FastifyReply): AdminSession | null {
  const session = readAdminSessionFromRequest(request);
  if (!session) {
    void reply.status(401).send({ error: "unauthorized" });
    return null;
  }

  return session;
}

export function requireGuildAccess(
  session: AdminSession,
  guildId: string,
  reply: FastifyReply
): boolean {
  const allowed = session.guilds.some((guild) => guild.id === guildId);
  if (!allowed) {
    void reply.status(403).send({ error: "forbidden" });
    return false;
  }

  return true;
}

export function assertValidOriginForMutation(request: FastifyRequest, reply: FastifyReply): boolean {
  const origin = request.headers.origin;
  if (!origin || origin !== env.adminUiOrigin) {
    void reply.status(403).send({ error: "invalid_origin" });
    return false;
  }

  return true;
}
