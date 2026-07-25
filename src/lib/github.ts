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

// Writes are serialized in-process and each merges into a freshly loaded
// cache, so concurrent getLatestRelease calls for different repos don't
// clobber each other's entries. The tmp name is unique per write to avoid
// cross-process tmp collisions.
let _writeLock: Promise<void> = Promise.resolve();

function saveCacheEntry(repo: string, entry: CacheEntry): Promise<void> {
  const task = _writeLock.then(async () => {
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    const cache = await loadCache();
    cache[repo] = entry;
    const tmp = `${CACHE_FILE}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, JSON.stringify(cache, null, 2));
    await rename(tmp, CACHE_FILE);
  });
  _writeLock = task.catch(() => {});
  return task;
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
      await saveCacheEntry(repo, { ...entry, fetchedAt: now });
      return entry.data;
    }

    if (!res.ok) return null;

    const data = (await res.json()) as ReleaseInfo;
    await saveCacheEntry(repo, { etag: res.headers.get("etag") ?? "", data, fetchedAt: now });
    return data;
  } catch {
    return entry?.data ?? null;
  }
}

export function findAsset(release: ReleaseInfo, pattern: RegExp): ReleaseAsset | undefined {
  return release.assets.find((a) => pattern.test(a.name));
}
