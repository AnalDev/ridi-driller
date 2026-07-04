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

export async function writeJson(rel: string, obj: unknown): Promise<void> {
  const full = path.join(DATA_DIR, rel);
  await ensureDir(path.dirname(full));
  await fs.writeFile(full, JSON.stringify(obj), "utf8");
}

export async function removeFile(rel: string): Promise<void> {
  try {
    await fs.unlink(path.join(DATA_DIR, rel));
  } catch {
    // ignore
  }
}

export { DATA_DIR };
