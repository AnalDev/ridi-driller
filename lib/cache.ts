import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJson<T>(rel: string): Promise<T | null> {
  try {
    const buf = await fs.readFile(path.join(DATA_DIR, rel), "utf8");
    return JSON.parse(buf) as T;
  } catch {
    return null;
  }
}

// Best-effort write. On read-only serverless filesystems (Vercel) this simply
// no-ops; the client keeps state in localStorage and the sync streams results,
// so persistence failing here is not fatal.
export async function writeJson(rel: string, obj: unknown): Promise<boolean> {
  try {
    const full = path.join(DATA_DIR, rel);
    await ensureDir(path.dirname(full));
    await fs.writeFile(full, JSON.stringify(obj), "utf8");
    return true;
  } catch {
    return false;
  }
}

export async function removeFile(rel: string): Promise<void> {
  try {
    await fs.unlink(path.join(DATA_DIR, rel));
  } catch {
    // ignore
  }
}

export { DATA_DIR };
