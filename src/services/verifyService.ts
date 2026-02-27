import { AuditAction } from "@prisma/client";
import bs58 from "bs58";
import jwt from "jsonwebtoken";
import nacl from "tweetnacl";
import { randomBytes } from "node:crypto";
import { env } from "../config/env";
import { prisma } from "../db/client";
import { logger } from "../utils/logger";
import { ensureGuild } from "./guildService";
import { writeAuditLog } from "./auditService";

type VerifyTokenPayload = {
  guildId: string;
  discordUserId: string;
  sessionId: string;
};

function makeChallengeMessage(input: {
  guildId: string;
  discordUserId: string;
  nonce: string;
  expiresAt: Date;
}): string {
  return `Verify Discord ${input.discordUserId} in Guild ${input.guildId} nonce ${input.nonce} exp ${input.expiresAt.toISOString()}`;
}

function signVerifyToken(payload: VerifyTokenPayload, expiresInSec: number): string {
  return jwt.sign(payload, env.VERIFY_TOKEN_SECRET, {
    algorithm: "HS256",
    expiresIn: expiresInSec,
    subject: payload.discordUserId
  });
}

function decodeVerifyToken(token: string): VerifyTokenPayload {
  const decoded = jwt.verify(token, env.VERIFY_TOKEN_SECRET, {
    algorithms: ["HS256"]
  });

  if (typeof decoded !== "object" || !decoded) {
    throw new Error("Invalid verify token payload");
  }

  const guildId = decoded.guildId;
  const discordUserId = decoded.discordUserId;
  const sessionId = decoded.sessionId;

  if (!guildId || !discordUserId || !sessionId) {
    throw new Error("Missing verify token claims");
  }

  return { guildId, discordUserId, sessionId };
}

export async function createVerifySession(input: {
  guildId: string;
  discordUserId: string;
}): Promise<{ token: string; verifyUrl: string; expiresAt: Date }> {
  await ensureGuild(input.guildId);

  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const challengeMessage = makeChallengeMessage({
    guildId: input.guildId,
    discordUserId: input.discordUserId,
    nonce,
    expiresAt
  });

  const session = await prisma.verifySession.create({
    data: {
      guildId: input.guildId,
      discordUserId: input.discordUserId,
      nonce,
      challengeMessage,
      expiresAt
    }
  });

  const token = signVerifyToken(
    {
      guildId: session.guildId,
      discordUserId: session.discordUserId,
      sessionId: session.id
    },
    10 * 60
  );

  return {
    token,
    verifyUrl: `${env.VERIFY_BASE_URL}?token=${encodeURIComponent(token)}`,
    expiresAt
  };
}

export async function getVerifyChallenge(token: string): Promise<{
  challengeMessage: string;
  expiresAt: Date;
}> {
  const payload = decodeVerifyToken(token);

  const session = await prisma.verifySession.findUnique({ where: { id: payload.sessionId } });
  if (!session) {
    throw new Error("Verify session not found");
  }

  if (session.guildId !== payload.guildId || session.discordUserId !== payload.discordUserId) {
    throw new Error("Verify session mismatch");
  }

  if (session.usedAt) {
    throw new Error("Verify session already used");
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new Error("Verify session expired");
  }

  return {
    challengeMessage: session.challengeMessage,
    expiresAt: session.expiresAt
  };
}

export async function submitVerifySignature(input: {
  token: string;
  walletPubkey: string;
  signatureBase58: string;
}): Promise<{ guildId: string; discordUserId: string; replaced: boolean }> {
  const payload = decodeVerifyToken(input.token);

  const session = await prisma.verifySession.findUnique({ where: { id: payload.sessionId } });
  if (!session) {
    throw new Error("Verify session not found");
  }

  if (session.usedAt) {
    throw new Error("Verify session already used");
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new Error("Verify session expired");
  }

  const signatureBytes = bs58.decode(input.signatureBase58);
  const pubkeyBytes = bs58.decode(input.walletPubkey);
  const messageBytes = new TextEncoder().encode(session.challengeMessage);

  const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, pubkeyBytes);
  if (!valid) {
    throw new Error("Invalid wallet signature");
  }

  const existing = await prisma.walletLink.findUnique({
    where: {
      guildId_discordUserId: {
        guildId: session.guildId,
        discordUserId: session.discordUserId
      }
    }
  });

  await prisma.verifySession.update({
    where: { id: session.id },
    data: { usedAt: new Date() }
  });

  const verifiedAt = new Date();

  await prisma.walletLink.upsert({
    where: {
      guildId_discordUserId: {
        guildId: session.guildId,
        discordUserId: session.discordUserId
      }
    },
    create: {
      guildId: session.guildId,
      discordUserId: session.discordUserId,
      walletPubkey: input.walletPubkey,
      verifiedAt
    },
    update: {
      walletPubkey: input.walletPubkey,
      verifiedAt
    }
  });

  const replaced = Boolean(existing && existing.walletPubkey !== input.walletPubkey);
  await writeAuditLog({
    guildId: session.guildId,
    discordUserId: session.discordUserId,
    roleId: "-",
    action: replaced ? AuditAction.VERIFY_REPLACED : AuditAction.VERIFY_SUCCESS,
    reason: replaced ? `wallet replaced ${existing?.walletPubkey} -> ${input.walletPubkey}` : `wallet verified ${input.walletPubkey}`
  });

  logger.info("Wallet verification successful", {
    guildId: session.guildId,
    discordUserId: session.discordUserId,
    walletPubkey: input.walletPubkey,
    replaced
  });

  return {
    guildId: session.guildId,
    discordUserId: session.discordUserId,
    replaced
  };
}

export async function unlinkWallet(input: {
  guildId: string;
  discordUserId: string;
}): Promise<{ deleted: boolean; wallet?: string }> {
  const existing = await prisma.walletLink.findUnique({
    where: {
      guildId_discordUserId: {
        guildId: input.guildId,
        discordUserId: input.discordUserId
      }
    }
  });

  if (!existing) {
    return { deleted: false };
  }

  await prisma.walletLink.delete({ where: { id: existing.id } });

  await writeAuditLog({
    guildId: input.guildId,
    discordUserId: input.discordUserId,
    roleId: "-",
    action: AuditAction.VERIFY_UNLINKED,
    reason: `wallet unlinked ${existing.walletPubkey}`
  });

  return { deleted: true, wallet: existing.walletPubkey };
}

export async function cleanupExpiredVerifySessions(): Promise<number> {
  const result = await prisma.verifySession.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { usedAt: { not: null } }]
    }
  });

  return result.count;
}
