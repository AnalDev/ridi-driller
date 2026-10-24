import type { RidiCreds } from "./types";

const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const CLEARANCE_RE = /^[A-Za-z0-9._-]+$/;
const PRINTABLE_ASCII_RE = /^[\x20-\x7e]+$/;

export function isRidiAccessToken(value: string): boolean {
  return value.length <= 4096 && ACCESS_TOKEN_RE.test(value);
}

export function isCloudflareClearance(value: string): boolean {
  return value.length <= 4096 && CLEARANCE_RE.test(value);
}

export function isSafeUserAgent(value: string): boolean {
  return value.length <= 512 && PRINTABLE_ASCII_RE.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function credentialsFromMap(values: Map<string, string>, userAgent?: string): RidiCreds | null {
  const ridiAt = values.get("ridi-at")?.trim() ?? "";
  if (!isRidiAccessToken(ridiAt)) return null;
  const cfCandidate = values.get("cf_clearance")?.trim();
  const cfClearance = cfCandidate && isCloudflareClearance(cfCandidate) ? cfCandidate : undefined;
  return {
    ridiAt,
    cfClearance,
    userAgent: userAgent && isSafeUserAgent(userAgent) ? userAgent : undefined,
  };
}

function parseCookieHeader(value: string): Map<string, string> {
  const cookies = new Map<string, string>();
  const header = value.replace(/^cookie\s*:\s*/i, "");
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const name = part.slice(0, separator).trim();
    const cookieValue = part.slice(separator + 1).trim();
    if (name) cookies.set(name, cookieValue);
  }
  return cookies;
}

function parseCookieJson(input: string): RidiCreds | null {
  let data: unknown;
  try {
    data = JSON.parse(input);
  } catch {
    return null;
  }
  const values = new Map<string, string>();
  const collect = (items: unknown[]) => {
    for (const item of items) {
      if (!isRecord(item) || typeof item.name !== "string" || typeof item.value !== "string") continue;
      values.set(item.name, item.value);
    }
  };
  if (Array.isArray(data)) {
    collect(data);
  } else if (isRecord(data) && Array.isArray(data.cookies)) {
    collect(data.cookies);
  } else if (isRecord(data)) {
    for (const [name, value] of Object.entries(data)) {
      if (typeof value === "string") values.set(name, value);
    }
  }
  return credentialsFromMap(values);
}

function quotedOptionValues(input: string, optionPattern: string): string[] {
  const pattern = new RegExp(`(?:^|\\s)(?:${optionPattern})(?:\\s+|=)(?:'([^']*)'|"([^"]*)")`, "gim");
  return [...input.matchAll(pattern)].map((match) => match[1] ?? match[2] ?? "");
}

function parseCurl(input: string): RidiCreds | null {
  let cookieHeader = quotedOptionValues(input, "-b|--cookie").at(-1);
  let userAgent = quotedOptionValues(input, "-A|--user-agent").at(-1)?.trim();
  for (const header of quotedOptionValues(input, "-H|--header")) {
    const separator = header.indexOf(":");
    if (separator < 1) continue;
    const name = header.slice(0, separator).trim().toLowerCase();
    const value = header.slice(separator + 1).trim();
    if (name === "cookie") cookieHeader = value;
    if (name === "user-agent") userAgent = value;
  }
  if (!cookieHeader) return null;
  return credentialsFromMap(parseCookieHeader(cookieHeader), userAgent);
}

export function parseRidiCredentials(input: string): RidiCreds | null {
  const value = input.trim();
  if (!value) return null;
  if (isRidiAccessToken(value)) return { ridiAt: value };
  if (value.startsWith("[") || value.startsWith("{")) return parseCookieJson(value);
  const curlCredentials = parseCurl(value);
  if (curlCredentials) return curlCredentials;
  if (/^(?:cookie\s*:)?[^\n]*ridi-at=/i.test(value)) {
    return credentialsFromMap(parseCookieHeader(value));
  }
  return null;
}
