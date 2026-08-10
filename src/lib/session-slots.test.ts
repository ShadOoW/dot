import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  AUTO_SLOT,
  LAST_SLOT,
  armAutoRestore,
  autoRestoreArmed,
  claimAutoRestore,
  discardAutoRestore,
  disarmAutoRestore,
  listSlots,
  readSlot,
  removeSlot,
  sanitizeSlotName,
  slotNameForSelector,
  slotPath,
  slotsDir,
  writeSlot,
} from "./session-slots.ts";
import type { Manifest, ManifestWindow } from "./session.ts";

// XDG_STATE_HOME is repointed at a temp dir *after* the module under test has
// been imported — that is the point: it proves the paths are resolved per call
// and not frozen at import time.
const originalStateHome = process.env.XDG_STATE_HOME;
let stateHome: string | undefined;

beforeEach(() => {
  stateHome = mkdtempSync(join(tmpdir(), "dot-slots-"));
  process.env.XDG_STATE_HOME = stateHome;
});

afterEach(() => {
  if (stateHome) rmSync(stateHome, { recursive: true, force: true });
  stateHome = undefined;
  if (originalStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = originalStateHome;
});

function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    version: 2,
    savedAt: 1_000,
    focusedWorkspace: 4,
    osWindows: [],
    apps: [],
    layout: null,
    agentsOrphaned: [],
    skipped: { scratchpad: [] },
    ...over,
  };
}

function osWindow(windows: ManifestWindow[]): Manifest["osWindows"][number] {
  return { kittyPid: 1, conId: 11, appId: "kitty", workspace: 4, tabs: [{ title: "t", windows }] };
}

describe("sanitizeSlotName", () => {
  test("accepts filename-safe names, lowercasing and collapsing punctuation runs", () => {
    expect(sanitizeSlotName("last")).toBe("last");
    expect(sanitizeSlotName("Work")).toBe("work");
    expect(sanitizeSlotName("My Cool Slot")).toBe("my-cool-slot");
    expect(sanitizeSlotName("a__b!!  c")).toBe("a__b-c"); // `_` is filename-safe and survives
    expect(sanitizeSlotName("agent-omp+command")).toBe("agent-omp+command");
    expect(sanitizeSlotName("web.dev")).toBe("web.dev");
    expect(sanitizeSlotName("-.lead.trail-.")).toBe("lead.trail");
  });

  test("sanitizing an already-sanitized name is a no-op, so write and read agree on the path", () => {
    for (const raw of ["Work", "My Cool Slot", "a__b!!  c", "-.lead.trail-."]) {
      const once = sanitizeSlotName(raw)!;
      expect(sanitizeSlotName(once)).toBe(once);
    }
  });

  test("rejects names that are empty, dot-only, or carry a path separator", () => {
    expect(sanitizeSlotName("")).toBeNull();
    expect(sanitizeSlotName("   ")).toBeNull();
    expect(sanitizeSlotName("---")).toBeNull();
    expect(sanitizeSlotName(".")).toBeNull();
    expect(sanitizeSlotName("..")).toBeNull();
    // Rejected, not flattened to "a-b" / "etc-passwd": a caller asking for one
    // slot must never silently get a different one.
    expect(sanitizeSlotName("a/b")).toBeNull();
    expect(sanitizeSlotName("../../etc/passwd")).toBeNull();
    expect(sanitizeSlotName("a\\b")).toBeNull();
  });
});

describe("slotNameForSelector", () => {
  test("a total save is always the last slot", () => {
    expect(slotNameForSelector(null)).toBe(LAST_SLOT);
  });

  test("terms join with +, flavours flatten with -", () => {
    expect(slotNameForSelector("agent")).toBe("agent");
    expect(slotNameForSelector("agent:omp")).toBe("agent-omp");
    expect(slotNameForSelector("agent:omp,command")).toBe("agent-omp+command");
    expect(slotNameForSelector(" agent:claude-work , shell ")).toBe("agent-claude-work+shell");
  });

  test("a selector with nothing usable still yields a name — the user is never prompted", () => {
    expect(slotNameForSelector(",,,")).toBe(AUTO_SLOT);
    expect(slotNameForSelector("")).toBe(AUTO_SLOT);
  });
});

describe("writeSlot / readSlot", () => {
  test("paths live under the runtime XDG_STATE_HOME, not the one captured at import", () => {
    expect(slotsDir().startsWith(stateHome!)).toBe(true);
    expect(slotsDir()).toBe(join(stateHome!, "dot/session/slots"));
  });

  test("round trips a manifest through a slot file", async () => {
    const m = manifest({
      savedAt: 42,
      osWindows: [osWindow([{ cwd: "/data/config/dot", kind: "shell" }])],
    });
    const path = await writeSlot("work", m);
    expect(path).toBe(slotPath("work"));
    expect(readSlot("work")).toEqual(m);
  });

  test("write sanitizes, so a messy name reads back under its clean one", async () => {
    await writeSlot("My Cool Slot", manifest());
    expect(existsSync(slotPath("my-cool-slot"))).toBe(true);
    expect(readSlot("My Cool Slot")).not.toBeNull();
    expect(readSlot("my-cool-slot")).not.toBeNull();
  });

  test("an unusable name throws rather than escaping the slots directory", async () => {
    await expect(writeSlot("../escape", manifest())).rejects.toThrow(/invalid slot name/);
  });

  test("missing, corrupt and non-v2 payloads all read as absent", async () => {
    expect(readSlot("nope")).toBeNull();

    mkdirSync(slotsDir(), { recursive: true });
    writeFileSync(slotPath("corrupt"), "{ not json");
    expect(readSlot("corrupt")).toBeNull();

    // A v1 manifest from the previous single-snapshot design must read as absent
    // so the caller says "save again" instead of restoring a dead shape.
    writeFileSync(slotPath("old"), JSON.stringify({ version: 1, savedAt: 1, osWindows: [] }));
    expect(readSlot("old")).toBeNull();

    writeFileSync(slotPath("shapeless"), JSON.stringify({ version: 2, savedAt: 1 }));
    expect(readSlot("shapeless")).toBeNull();
  });
});

describe("listSlots", () => {
  test("a missing slots directory is an empty list, not a throw", async () => {
    expect(await listSlots()).toEqual([]);
    mkdirSync(slotsDir(), { recursive: true });
    expect(await listSlots()).toEqual([]);
  });

  test("newest first, with unreadable files skipped", async () => {
    await writeSlot("older", manifest({ savedAt: 100 }));
    await writeSlot("newest", manifest({ savedAt: 300 }));
    await writeSlot("middle", manifest({ savedAt: 200 }));
    writeFileSync(slotPath("junk"), "{");
    writeFileSync(join(slotsDir(), "notes.txt"), "ignored");
    // A hand-dropped Work.json would otherwise be listed under a name that
    // reads back as work.json — a different slot entirely.
    writeFileSync(join(slotsDir(), "Work.json"), JSON.stringify(manifest({ savedAt: 400 })));

    expect((await listSlots()).map((s) => s.name)).toEqual(["newest", "middle", "older"]);
  });

  test("counts use the shared group labels, keyed by launcher for agents", async () => {
    await writeSlot(
      "desk",
      manifest({
        osWindows: [
          osWindow([
            { cwd: "/a", kind: "agent", agent: { agent: "omp", command: "omp", sessionId: "s1" } },
            { cwd: "/b", kind: "agent", agent: { agent: "claude", command: "claude-work", sessionId: null } },
            { cwd: "/c", kind: "agent", agent: { agent: "claude", command: "claude-work", sessionId: "s2" } },
            { cwd: "/d", kind: "command", command: ["npm", "run", "debug"] },
            { cwd: "/e", kind: "shell" },
          ]),
        ],
        apps: [
          { appId: "firefox", conId: null, workspace: 2, argv: ["firefox"] },
          { appId: "spotify", conId: null, workspace: 9, argv: null },
        ],
        agentsOrphaned: [{ agent: "omp", command: "omp", sessionId: "s3", cwd: "/f" }],
      }),
    );

    const [slot] = await listSlots();
    expect(slot!.counts).toEqual({
      "agent:omp": 1,
      "agent:claude-work": 2,
      command: 1,
      shell: 1,
      app: 2,
      "agent (no window)": 1,
    });
    expect(slot!.path).toBe(slotPath("desk"));
    expect(slot!.savedAt).toBe(1_000);
  });

  test("a manifest with nothing in it reports no groups at all", async () => {
    await writeSlot("empty", manifest());
    expect((await listSlots())[0]!.counts).toEqual({});
  });

  test("armed marks exactly the slot the login trigger points at", async () => {
    await writeSlot(LAST_SLOT, manifest({ savedAt: 200 }));
    await writeSlot("agent-omp", manifest({ savedAt: 100 }));
    await armAutoRestore("agent-omp");

    expect(await listSlots()).toMatchObject([{ name: LAST_SLOT, armed: false }, { name: "agent-omp", armed: true }]);
  });
});

describe("removeSlot", () => {
  test("removes an existing slot and reports whether there was one", async () => {
    await writeSlot("scratch", manifest());
    expect(await removeSlot("scratch")).toBe(true);
    expect(existsSync(slotPath("scratch"))).toBe(false);
    expect(await removeSlot("scratch")).toBe(false);
    expect(await removeSlot("../escape")).toBe(false);
  });

  test("removing the armed slot takes its login trigger with it", async () => {
    await writeSlot("doomed", manifest());
    await writeSlot(LAST_SLOT, manifest());
    await armAutoRestore("doomed");

    await removeSlot("doomed");
    expect(autoRestoreArmed()).toBeNull();

    // An unrelated removal leaves the trigger alone.
    await armAutoRestore(LAST_SLOT);
    await writeSlot("other", manifest());
    await removeSlot("other");
    expect(autoRestoreArmed()).toBe(LAST_SLOT);
  });
});

describe("auto-restore token", () => {
  test("nothing is armed before a save", async () => {
    expect(autoRestoreArmed()).toBeNull();
    expect(await claimAutoRestore()).toBeNull();
  });

  test("arm names the slot, claim fires exactly once, and the slot survives", async () => {
    const m = manifest({ savedAt: 7, osWindows: [osWindow([{ cwd: "/data/config/dot", kind: "shell" }])] });
    await writeSlot("agent-omp", m);
    await armAutoRestore("agent-omp");
    expect(autoRestoreArmed()).toBe("agent-omp");

    const claimed = await claimAutoRestore();
    expect(claimed!.slot).toBe("agent-omp");
    expect(claimed!.manifest).toEqual(m);

    // The one-shot guarantee: a crash-restart or a racing login gets nothing.
    expect(await claimAutoRestore()).toBeNull();

    await discardAutoRestore(claimed!.claimedToken);
    expect(existsSync(claimed!.claimedToken)).toBe(false);
    expect(autoRestoreArmed()).toBeNull();
    // Durability: consuming the trigger never consumes the snapshot.
    expect(readSlot("agent-omp")).toEqual(m);
  });

  test("an in-flight claim still reads as armed, so a re-arm is not lost", async () => {
    await writeSlot("last", manifest());
    await armAutoRestore(LAST_SLOT);
    const claimed = await claimAutoRestore();
    expect(autoRestoreArmed()).toBe(LAST_SLOT);
    await discardAutoRestore(claimed!.claimedToken);
  });

  test("re-arming clears a stale claim left behind by a crashed restore", async () => {
    await writeSlot(LAST_SLOT, manifest());
    await armAutoRestore(LAST_SLOT);
    await claimAutoRestore(); // crash here: claim file left on disk

    await armAutoRestore(LAST_SLOT);
    expect(await claimAutoRestore()).not.toBeNull();
  });

  test("a trigger pointing at a vanished slot is consumed, not left armed forever", async () => {
    await writeSlot("gone", manifest());
    await armAutoRestore("gone");
    rmSync(slotPath("gone"));

    expect(await claimAutoRestore()).toBeNull();
    expect(autoRestoreArmed()).toBeNull();
  });

  test("disarm drops the trigger and leaves every slot on disk", async () => {
    await writeSlot(LAST_SLOT, manifest());
    await armAutoRestore(LAST_SLOT);
    await disarmAutoRestore();

    expect(autoRestoreArmed()).toBeNull();
    expect(await claimAutoRestore()).toBeNull();
    expect(readSlot(LAST_SLOT)).not.toBeNull();
  });

  test("the pre-slots zero-byte token resolves to the last slot", async () => {
    mkdirSync(join(stateHome!, "dot/session"), { recursive: true });
    writeFileSync(join(stateHome!, "dot/session/autorestore"), "");
    expect(autoRestoreArmed()).toBe(LAST_SLOT);

    // …and fails closed, because the old design never wrote a `last` slot.
    expect(await claimAutoRestore()).toBeNull();
  });
});
