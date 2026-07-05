import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { HOME_DIR } from "./config.ts";

const CACHE_FILE = join(HOME_DIR, ".cache/assets/releases.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ReleaseAsset = { name: string; browser_download_url: string };
type ReleaseInfo = { tag_name: string; tarball_url: string; assets: ReleaseAsset[] };
type CacheEntry = { etag: string; data: ReleaseInfo; fetchedAt: number };
type Cache = Record<string, CacheEntry>;

async function loadCache(): Promise<Cache> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

async function saveCache(cache: Cache): Promise<void> {
  await mkdir(dirname(CACHE_FILE), { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(cache, null, 2));
  await rename(tmp, CACHE_FILE);
}

const _inFlight = new Map<string, Promise<ReleaseInfo | null>>();

export function getLatestRelease(repo: string): Promise<ReleaseInfo | null> {
  const fly = _inFlight.get(repo);
  if (fly) return fly;
  const p = _getLatestRelease(repo).finally(() => _inFlight.delete(repo));
  _inFlight.set(repo, p);
  return p;
}

async function _getLatestRelease(repo: string): Promise<ReleaseInfo | null> {
  const cache = await loadCache();
  const entry = cache[repo];
  const now = Date.now();

  if (entry && now - entry.fetchedAt < CACHE_TTL_MS) return entry.data;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (entry?.etag) headers["If-None-Match"] = entry.etag;

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });

    if (res.status === 304 && entry) {
      cache[repo] = { ...entry, fetchedAt: now };
      await saveCache(cache);
      return entry.data;
    }

    if (!res.ok) return null;

    const data = (await res.json()) as ReleaseInfo;
    cache[repo] = { etag: res.headers.get("etag") ?? "", data, fetchedAt: now };
    await saveCache(cache);
    return data;
  } catch {
    return entry?.data ?? null;
  }
}

export function findAsset(release: ReleaseInfo, pattern: RegExp): ReleaseAsset | undefined {
  return release.assets.find((a) => pattern.test(a.name));
}

export async function getLatestCommit(repo: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits/HEAD`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { sha: string };
    return data.sha.slice(0, 8);
  } catch {
    return null;
  }
}
