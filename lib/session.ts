import crypto from "crypto";
import { cookies } from "next/headers";
import type { RidiCreds } from "./ridi/types";

// Session state lives entirely in an httpOnly cookie (no filesystem), so it
// works on read-only serverless hosts (Vercel) as well as locally.
// The creds are encrypted with RD_SECRET when set; otherwise stored as plain
// base64 (still httpOnly + secure, same threat model as RIDI's own cookies).
export const SESSION_COOKIE = "rd_sess";

function key(): Buffer | null {
  const secret = process.env.RD_SECRET;
  return secret ? crypto.createHash("sha256").update(secret).digest() : null;
}

export function encodeCreds(creds: RidiCreds): string {
  const json = JSON.stringify(creds);
  const k = key();
  if (!k) return "p." + Buffer.from(json, "utf8").toString("base64url");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return "e." + Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decodeCreds(value: string): RidiCreds | null {
  try {
    const [kind, data] = [value.slice(0, 2), value.slice(2)];
    if (kind === "p.") {
      return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    }
    if (kind === "e.") {
      const k = key();
      if (!k) return null;
      const buf = Buffer.from(data, "base64url");
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const ct = buf.subarray(28);
      const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv);
      decipher.setAuthTag(tag);
      const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
      return JSON.parse(dec.toString("utf8"));
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSessionCreds(): Promise<RidiCreds | null> {
  const v = (await cookies()).get(SESSION_COOKIE)?.value;
  return v ? decodeCreds(v) : null;
}

/**
 * Stable per-user key derived from the ridi-at token (u_idx / sub), used to
 * namespace the optional local file cache. Returns null if unreadable.
 */
export async function getUserKey(): Promise<string | null> {
  const creds = await getSessionCreds();
  if (!creds) return null;
  try {
    const payload = creds.ridiAt.split(".")[1];
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const id = String(claims.u_idx ?? claims.sub ?? "");
    return id ? id.replace(/[^a-zA-Z0-9_-]/g, "") : null;
  } catch {
    return null;
  }
}
