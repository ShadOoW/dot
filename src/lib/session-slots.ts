import { existsSync, readFileSync } from "fs";
import { mkdir, readdir, rename, rm } from "fs/promises";
import { join } from "path";
import { STATE_DIR } from "./config.ts";
import type { Manifest } from "./session.ts";

// Named snapshot slots for `dot session`, replacing the single fixed
// manifest.json of the previous design.
//
// A save ALWAYS writes the complete manifest to the `last` slot, and
// ADDITIONALLY writes a named slot when the save was partial or `--as <name>`
// was given. The double write is deliberate: a full-desktop manifest measures
// 2244 bytes on this host, so the guaranteed-complete copy costs ~2 KB per save
// and removes the entire class of "my full snapshot was clobbered by a partial
// save" — the failure mode a single fixed file makes unavoidable.
//
// Slots are DURABLE: restore reads one and leaves it in place, so a snapshot
// survives a re-restore, a partial failure and an unplanned reboot. The one-shot
// "auto-restore on next login" token is therefore kept as a separate file one
// directory up from the slots, never inside them — that separation is the only
// reason a login restore cannot consume a durable snapshot. Login claims the
// token by atomic rename, so a crash or a racing invocation can never
// double-fire, and the token's *content* is the name of the slot to restore,
// which the rename carries across to the claim file intact.

/** Every save writes here, complete, whatever else it writes. */
export const LAST_SLOT = "last";
/** Fallback name when a selector carries no usable characters — never prompt. */
export const AUTO_SLOT = "auto";

export interface SlotInfo {
  name: string;
  path: string;
  savedAt: number;
  /** Window count per group label: "agent:omp", "command", "shell", "app", "agent (no window)". */
  counts: Record<string, number>;
  armed: boolean;
}

// STATE_DIR is computed from XDG_STATE_HOME when config.ts is first imported, so
// a module-level `const` here would freeze the location before a test could
// point XDG_STATE_HOME at a temp dir. Every path is resolved per call instead.
function sessionDir(): string {
  const xdg = process.env.XDG_STATE_HOME;
  return join(xdg ? join(xdg, "dot") : STATE_DIR, "session");
}

export function slotsDir(): string {
  return join(sessionDir(), "slots");
}

/** Raw join — pass a name that already came from `sanitizeSlotName`. */
export function slotPath(name: string): string {
  return join(slotsDir(), `${name}.json`);
}

function autoRestorePath(): string {
  return join(sessionDir(), "autorestore");
}

function autoRestoreClaimPath(): string {
  return join(sessionDir(), "autorestore.claiming");
}

/**
 * Slot names become filenames, so only `[a-z0-9._+-]` survives; runs of anything
 * else collapse to a single `-`. A name carrying a path separator is rejected
 * rather than flattened, because silently turning `foo/bar` into `foo-bar` would
 * hand back a slot the caller never asked for. Returns null when nothing usable
 * is left.
 */
export function sanitizeSlotName(name: string): string | null {
  if (/[/\\\0]/.test(name)) return null;
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._+-]+/g, "-")
    .replace(/^[-.]+/, "")
    .replace(/[-.]+$/, "");
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Derives the slot name for a `--only`/`--except` selector so a partial save
 * never has to ask the user for one. A total save (null) is always `last`;
 * otherwise `:` becomes `-` and the comma between terms becomes `+`, giving
 * `agent:omp,command` -> `agent-omp+command`.
 */
export function slotNameForSelector(selector: string | null): string {
  if (selector === null) return LAST_SLOT;
  const derived = selector
    .split(",")
    .map((term) => term.trim().replace(/:/g, "-"))
    .filter((term) => term.length > 0)
    .join("+");
  return sanitizeSlotName(derived) ?? AUTO_SLOT;
}

export async function writeSlot(name: string, m: Manifest): Promise<string> {
  const safe = sanitizeSlotName(name);
  if (safe === null) throw new Error(`invalid slot name: ${JSON.stringify(name)}`);
  await mkdir(slotsDir(), { recursive: true });
  const path = slotPath(safe);
  await Bun.write(path, JSON.stringify(m, null, 2) + "\n");
  return path;
}

export function readSlot(name: string): Manifest | null {
  const safe = sanitizeSlotName(name);
  if (safe === null) return null;
  const path = slotPath(safe);
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8")) as Partial<Manifest> | null;
    // There is no v1 compatibility. A leftover manifest.json from the previous
    // design — or any JSON that is not a v2 manifest — must read as *absent* so
    // callers tell the user to save again instead of restoring a dead shape.
    if (!data || data.version !== 2) return null;
    if (![data.osWindows, data.apps, data.agentsOrphaned].every(Array.isArray)) return null;
    return data as Manifest;
  } catch {
    return null;
  }
}

function groupCounts(m: Manifest): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const osWindow of m.osWindows) {
    for (const tab of osWindow.tabs) {
      for (const win of tab.windows) {
        // The flavour of an agent window is its launcher, not its adapter id. An
        // agent window whose ref never resolved still has to land in a bucket
        // rather than disappear from the totals the user is shown.
        const label = win.kind === "agent" ? `agent:${win.agent?.command ?? "unknown"}` : win.kind;
        counts[label] = (counts[label] ?? 0) + 1;
      }
    }
  }
  if (m.apps.length > 0) counts["app"] = m.apps.length;
  if (m.agentsOrphaned.length > 0) counts["agent (no window)"] = m.agentsOrphaned.length;
  return counts;
}

/** Newest first. A missing slots directory is simply an empty list. */
export async function listSlots(): Promise<SlotInfo[]> {
  let entries: string[];
  try {
    entries = await readdir(slotsDir());
  } catch {
    return [];
  }
  const armed = autoRestoreArmed();
  const slots: SlotInfo[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const name = entry.slice(0, -".json".length);
    // A filename writeSlot would never produce would alias a different slot on
    // read, so it is not a slot.
    if (sanitizeSlotName(name) !== name) continue;
    const m = readSlot(name);
    if (!m) continue;
    slots.push({ name, path: slotPath(name), savedAt: m.savedAt, counts: groupCounts(m), armed: name === armed });
  }
  // Name breaks ties so two slots saved in the same millisecond still list in a
  // stable order across runs.
  slots.sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name));
  return slots;
}

export async function removeSlot(name: string): Promise<boolean> {
  const safe = sanitizeSlotName(name);
  if (safe === null) return false;
  const path = slotPath(safe);
  if (!existsSync(path)) return false;
  await rm(path, { force: true });
  // A trigger pointing at a slot that no longer exists would fire at login and
  // silently restore nothing, so it goes with the slot.
  if (autoRestoreArmed() === safe) await disarmAutoRestore();
  return true;
}

/** Arm the one-shot login trigger on `slot`; the slot itself stays durable. */
export async function armAutoRestore(slot: string): Promise<void> {
  await mkdir(sessionDir(), { recursive: true });
  await Bun.write(autoRestorePath(), `${slot}\n`);
  await rm(autoRestoreClaimPath(), { force: true }); // drop any stale in-flight claim
}

function tokenSlot(path: string): string | null {
  try {
    // An empty token is the pre-slots zero-byte sentinel: name it `last` so it
    // resolves through the normal path and fails closed when no `last` exists.
    return readFileSync(path, "utf-8").trim() || LAST_SLOT;
  } catch {
    return null;
  }
}

/** Name of the slot the login trigger would restore, or null when nothing is armed. */
export function autoRestoreArmed(): string | null {
  // A claimed token still counts as armed — the restore it belongs to is in flight.
  return tokenSlot(autoRestorePath()) ?? tokenSlot(autoRestoreClaimPath());
}

/**
 * Atomically consume the one-shot auto-restore token so a login restore fires
 * exactly once per save, even across a crash or a racing invocation. The rename
 * comes first and is the claim itself: only the winner then reads the slot name
 * the token carries. The slot is left untouched — only the token is claimed.
 * Returns null when nothing is armed, or when the slot it named is gone.
 */
export async function claimAutoRestore(): Promise<{ slot: string; manifest: Manifest; claimedToken: string } | null> {
  const claimedToken = autoRestoreClaimPath();
  try {
    await rename(autoRestorePath(), claimedToken);
  } catch {
    return null; // not armed, or another restore raced us
  }
  const slot = tokenSlot(claimedToken) ?? LAST_SLOT;
  const manifest = readSlot(slot);
  if (!manifest) {
    // The slot was deleted under us; drop the claim so it does not read as armed forever.
    await rm(claimedToken, { force: true });
    return null;
  }
  return { slot, manifest, claimedToken };
}

/** Drop the claimed token after a login restore. The slot file stays on disk. */
export async function discardAutoRestore(claimedToken: string): Promise<void> {
  await rm(claimedToken, { force: true });
}

/** Disarm the one-shot login trigger without touching any durable slot. */
export async function disarmAutoRestore(): Promise<void> {
  await rm(autoRestorePath(), { force: true });
  await rm(autoRestoreClaimPath(), { force: true });
}
