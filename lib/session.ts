import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { cookies } from "next/headers";
import { DATA_DIR, readJson, writeJson, removeFile } from "./cache";
import type { RidiCreds } from "./ridi/types";

export const SESSION_COOKIE = "rd_sid";

// ---- encryption key (persisted so restarts can still decrypt) ----
let cachedKey: Buffer | null = null;
async function getKey(): Promise<Buffer> {
  if (cachedKey) return cachedKey;
  if (process.env.RD_SECRET) {
    cachedKey = crypto.createHash("sha256").update(process.env.RD_SECRET).digest();
    return cachedKey;
  }
  const keyPath = path.join(DATA_DIR, ".key");
  try {
    cachedKey = Buffer.from(await fs.readFile(keyPath, "utf8"), "hex");
  } catch {
    cachedKey = crypto.randomBytes(32);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(keyPath, cachedKey.toString("hex"), "utf8");
  }
  return cachedKey;
}

async function encrypt(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), enc.toString("hex")].join(".");
}

async function decrypt(blob: string): Promise<string | null> {
  try {
    const key = await getKey();
    const [ivHex, tagHex, dataHex] = blob.split(".");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

interface StoredSession {
  creds: string; // encrypted JSON of RidiCreds
  createdAt: number;
}

/** Create a session file with encrypted creds; returns the session id. */
export async function createSession(creds: RidiCreds): Promise<string> {
  const sid = crypto.randomUUID();
  const stored: StoredSession = {
    creds: await encrypt(JSON.stringify(creds)),
    createdAt: Date.now(),
  };
  await writeJson(`sessions/${sid}.json`, stored);
  return sid;
}

/** Load creds for the current request's session cookie, or null. */
export async function getSessionCreds(): Promise<RidiCreds | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sid) return null;
  const stored = await readJson<StoredSession>(`sessions/${sanitize(sid)}.json`);
  if (!stored) return null;
  const json = await decrypt(stored.creds);
  if (!json) return null;
  try {
    return JSON.parse(json) as RidiCreds;
  } catch {
    return null;
  }
}

export async function getSessionId(): Promise<string | null> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  return sid ? sanitize(sid) : null;
}

export async function destroySession(): Promise<void> {
  const sid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (sid) await removeFile(`sessions/${sanitize(sid)}.json`);
}

// prevent path traversal via the cookie value
function sanitize(sid: string): string {
  return sid.replace(/[^a-zA-Z0-9-]/g, "");
}
