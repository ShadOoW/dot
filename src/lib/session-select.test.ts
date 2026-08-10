import { describe, expect, test } from "bun:test";
import {
  enumerateWindows,
  formatRow,
  matchesSelector,
  parseSelector,
  selectManifest,
  selectorForRefs,
  type SelectableWindow,
  type VerdictFn,
} from "./session-select.ts";
import type { Manifest, ManifestOsWindow, ManifestWindow } from "./session.ts";

const agentWindow = (cwd: string, command: string, sessionId: string | null): ManifestWindow => ({
  cwd,
  kind: "agent",
  agent: { agent: command.startsWith("omp") ? "omp" : "claude", command, sessionId },
});

const osWindow = (...tabs: ManifestWindow[][]): ManifestOsWindow => ({
  kittyPid: 1,
  conId: 11,
  appId: "kitty",
  workspace: 4,
  tabs: tabs.map((windows, i) => ({ title: `t${i}`, windows })),
});

function manifestWith(over: Partial<Manifest> = {}): Manifest {
  return {
    version: 2,
    savedAt: 1700000000,
    focusedWorkspace: 4,
    osWindows: [],
    apps: [],
    layout: null,
    agentsOrphaned: [],
    skipped: { scratchpad: ["terminal-mark"] },
    ...over,
  };
}

/** Stands in for buildRestorePlan: the seam this module is built around. */
const restorable: VerdictFn = () => ({ verdict: "", restorable: true });

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("parseSelector", () => {
  test("accepts every term in the grammar", () => {
    expect(parseSelector("all")).toEqual({ terms: [{ kind: "all", flavour: null }] });
    expect(parseSelector("agent")).toEqual({ terms: [{ kind: "agent", flavour: null }] });
    expect(parseSelector("agent:omp")).toEqual({ terms: [{ kind: "agent", flavour: "omp" }] });
    expect(parseSelector("shell,command")).toEqual({
      terms: [
        { kind: "shell", flavour: null },
        { kind: "command", flavour: null },
      ],
    });
  });

  test("tolerates whitespace and stray separators around terms", () => {
    expect(parseSelector("  shell , agent:claude-work ,")).toEqual({
      terms: [
        { kind: "shell", flavour: null },
        { kind: "agent", flavour: "claude-work" },
      ],
    });
  });

  test("rejects unknown kinds, flavours on non-agents, and empty input", () => {
    // A typo must not silently become "match nothing" — the caller needs to fail loudly.
    expect(parseSelector("agents")).toBeNull();
    expect(parseSelector("shell:zsh")).toBeNull();
    expect(parseSelector("agent:")).toBeNull();
    expect(parseSelector("agent:omp:extra")).toBeNull();
    expect(parseSelector("")).toBeNull();
    expect(parseSelector(" , ")).toBeNull();
    expect(parseSelector("shell,nope")).toBeNull();
  });
});

describe("matchesSelector", () => {
  const win = (kind: SelectableWindow["kind"], flavour: string | null): SelectableWindow => ({
    ref: "0.0.0",
    kind,
    flavour,
    group: flavour ? `agent:${flavour}` : kind,
    cwd: "/x",
    detail: "",
    verdict: "",
    restorable: true,
  });

  test("agent matches every flavour, agent:<launcher> matches only its own", () => {
    const omp = win("agent", "omp");
    const work = win("agent", "claude-work");
    const anyAgent = parseSelector("agent")!;
    expect(matchesSelector(omp, anyAgent)).toBe(true);
    expect(matchesSelector(work, anyAgent)).toBe(true);

    const ompOnly = parseSelector("agent:omp")!;
    expect(matchesSelector(omp, ompOnly)).toBe(true);
    expect(matchesSelector(work, ompOnly)).toBe(false);
    expect(matchesSelector(win("shell", null), ompOnly)).toBe(false);
  });

  test("all matches everything; a multi-term selector is a union", () => {
    const all = parseSelector("all")!;
    for (const w of [win("agent", "omp"), win("shell", null), win("app", null)]) {
      expect(matchesSelector(w, all)).toBe(true);
    }
    const mixed = parseSelector("shell,app")!;
    expect(matchesSelector(win("shell", null), mixed)).toBe(true);
    expect(matchesSelector(win("app", null), mixed)).toBe(true);
    expect(matchesSelector(win("command", null), mixed)).toBe(false);
  });
});

describe("enumerateWindows", () => {
  const m = manifestWith({
    osWindows: [
      osWindow(
        [agentWindow("/data/ops", "claude-work", "abc-123"), { cwd: "/data/ops", kind: "shell" }],
        [{ cwd: "/x", kind: "command", command: ["npm", "run", "debug"] }],
      ),
      osWindow([agentWindow("/data/me", "omp", null)]),
    ],
    apps: [{ appId: "firefox", conId: null, workspace: 2, argv: ["firefox", "--new-window"] }],
    agentsOrphaned: [{ agent: "claude", command: "claude-personal", sessionId: "zzz-999", cwd: "/data/side" }],
  });

  test("refs are positional and ordered osWindows, then apps, then orphans", () => {
    expect(enumerateWindows(m, restorable).map((w) => w.ref)).toEqual([
      "0.0.0",
      "0.0.1",
      "0.1.0",
      "1.0.0",
      "app.0",
      "orphan.0",
    ]);
  });

  test("kind, flavour and group labels follow the shared contract", () => {
    const rows = enumerateWindows(m, restorable);
    expect(rows.map((w) => w.group)).toEqual([
      "agent:claude-work",
      "shell",
      "command",
      "agent:omp",
      "app",
      "agent (no window)",
    ]);
    // The flavour is always the launcher, never the adapter id.
    expect(rows[3]!.flavour).toBe("omp");
    expect(rows[5]!).toMatchObject({ kind: "agent", flavour: "claude-personal", cwd: "/data/side" });
    expect(rows[4]!).toMatchObject({ kind: "app", flavour: null });
  });

  test("detail describes what occupies the window", () => {
    expect(enumerateWindows(m, restorable).map((w) => w.detail)).toEqual([
      "abc-123",
      "shell",
      "npm run debug",
      "(no session id)",
      "firefox --new-window",
      "zzz-999",
    ]);
  });

  test("the verdict callback is handed each node with its own ref", () => {
    const seen: string[] = [];
    const rows = enumerateWindows(m, (w, ref) => {
      seen.push(`${ref}:${"cwd" in w ? w.cwd : w.appId}`);
      return { verdict: `v-${ref}`, restorable: ref !== "1.0.0" };
    });
    expect(seen).toEqual([
      "0.0.0:/data/ops",
      "0.0.1:/data/ops",
      "0.1.0:/x",
      "1.0.0:/data/me",
      "app.0:firefox",
      "orphan.0:/data/side",
    ]);
    expect(rows[0]!.verdict).toBe("v-0.0.0");
    expect(rows.filter((w) => !w.restorable).map((w) => w.ref)).toEqual(["1.0.0"]);
  });

  test("an agent window whose capture lost its AgentRef stays visible", () => {
    const broken = manifestWith({ osWindows: [osWindow([{ cwd: "/x", kind: "agent", agent: null }])] });
    expect(enumerateWindows(broken, restorable)[0]!).toMatchObject({
      kind: "agent",
      flavour: null,
      group: "agent",
      detail: "(no agent)",
    });
  });
});

describe("selectManifest", () => {
  const base = () =>
    manifestWith({
      osWindows: [
        osWindow([agentWindow("/a", "omp", "s1"), { cwd: "/a", kind: "shell" }], [{ cwd: "/b", kind: "shell" }]),
        osWindow([{ cwd: "/c", kind: "shell" }]),
      ],
      apps: [
        { appId: "firefox", conId: null, workspace: 2, argv: ["firefox"] },
        { appId: "obsidian", conId: null, workspace: 3, argv: null },
      ],
      agentsOrphaned: [
        { agent: "omp", command: "omp", sessionId: "o1", cwd: "/d" },
        { agent: "claude", command: "claude-work", sessionId: "o2", cwd: "/e" },
      ],
    });

  test("prunes emptied tabs and emptied os-windows, keeps a partially-selected tab", () => {
    const out = selectManifest(base(), new Set(["0.0.0", "app.1", "orphan.1"]));
    expect(out.osWindows.length).toBe(1);
    expect(out.osWindows[0]!.tabs.length).toBe(1);
    expect(out.osWindows[0]!.tabs[0]!.title).toBe("t0");
    expect(out.osWindows[0]!.tabs[0]!.windows.map((w) => w.kind)).toEqual(["agent"]);
    expect(out.apps.map((a) => a.appId)).toEqual(["obsidian"]);
    expect(out.agentsOrphaned.map((a) => a.sessionId)).toEqual(["o2"]);
  });

  test("selecting nothing yields an empty manifest that still carries its metadata", () => {
    const out = selectManifest(base(), new Set());
    expect(out.osWindows).toEqual([]);
    expect(out.apps).toEqual([]);
    expect(out.agentsOrphaned).toEqual([]);
    expect(out.version).toBe(2);
    expect(out.savedAt).toBe(1700000000);
    expect(out.focusedWorkspace).toBe(4);
    expect(out.skipped).toEqual({ scratchpad: ["terminal-mark"] });
  });

  test("selecting everything round-trips the manifest unchanged", () => {
    const m = base();
    const refs = new Set(enumerateWindows(m, restorable).map((w) => w.ref));
    expect(selectManifest(m, refs)).toEqual(m);
  });

  test("never mutates its input", () => {
    const m = base();
    const before = structuredClone(m);
    selectManifest(m, new Set(["1.0.0"]));
    expect(m).toEqual(before);
  });

  test("refs are positional, so a narrowed manifest renumbers them", () => {
    // Callers must enumerate and select against the same manifest; this is why
    // the picker and the filter are handed one snapshot rather than two.
    const narrowed = selectManifest(base(), new Set(["1.0.0"]));
    expect(enumerateWindows(narrowed, restorable).map((w) => w.ref)).toEqual(["0.0.0"]);
    expect(narrowed.osWindows[0]!.tabs[0]!.windows[0]!.cwd).toBe("/c");
  });
});

describe("selectorForRefs", () => {
  const m = manifestWith({
    osWindows: [
      osWindow([
        agentWindow("/a", "omp", "s1"),
        agentWindow("/b", "claude-work", "s2"),
        { cwd: "/c", kind: "shell" },
        { cwd: "/e", kind: "shell" },
        { cwd: "/d", kind: "command", command: ["npm", "test"] },
      ]),
    ],
    apps: [{ appId: "firefox", conId: null, workspace: 2, argv: ["firefox"] }],
  });
  const all = enumerateWindows(m, restorable);
  const refsFor = (pred: (w: SelectableWindow) => boolean) => new Set(all.filter(pred).map((w) => w.ref));

  test("a total selection has no flag to print", () => {
    expect(selectorForRefs(all, new Set(all.map((w) => w.ref)))).toBeNull();
  });

  test("a fully-selected group collapses to its group term", () => {
    expect(selectorForRefs(all, refsFor((w) => w.flavour === "omp"))).toBe("agent:omp");
    expect(selectorForRefs(all, refsFor((w) => w.kind === "shell"))).toBe("shell");
    expect(selectorForRefs(all, refsFor((w) => w.kind === "agent"))).toBe("agent:claude-work,agent:omp");
  });

  test("terms are emitted in a canonical order regardless of manifest order", () => {
    expect(selectorForRefs(all, refsFor((w) => w.kind !== "agent"))).toBe("command,shell,app");
  });

  test("a half-selected group has no term that reproduces it", () => {
    // Printing `--only shell` here would silently widen the selection back out.
    const oneShell = new Set([all.find((w) => w.kind === "shell")!.ref]);
    expect(selectorForRefs(all, oneShell)).toBeNull();
    expect(selectorForRefs(all, new Set([...oneShell, ...refsFor((w) => w.kind === "agent")]))).toBeNull();
  });

  test("an orphaned agent shares the launcher's term, so leaving it out is inexpressible", () => {
    const withOrphan = manifestWith({
      ...m,
      agentsOrphaned: [{ agent: "omp", command: "omp", sessionId: "o1", cwd: "/z" }],
    });
    const rows = enumerateWindows(withOrphan, restorable);
    const windowedOmpOnly = new Set(rows.filter((w) => w.flavour === "omp" && w.ref !== "orphan.0").map((w) => w.ref));
    expect(selectorForRefs(rows, windowedOmpOnly)).toBeNull();
    const everyOmp = new Set(rows.filter((w) => w.flavour === "omp").map((w) => w.ref));
    expect(selectorForRefs(rows, everyOmp)).toBe("agent:omp");
  });

  test("an empty selection has nothing to print either", () => {
    expect(selectorForRefs(all, new Set())).toBeNull();
  });
});

describe("formatRow", () => {
  const row = (over: Partial<SelectableWindow>): SelectableWindow => ({
    ref: "0.0.0",
    kind: "shell",
    flavour: null,
    group: "shell",
    cwd: "/home/shad/dev/dot",
    detail: "shell",
    verdict: "shell",
    restorable: true,
    ...over,
  });

  test("shortens the cwd and hides a verdict that only repeats the detail", () => {
    const out = plain(formatRow(row({ detail: "npm run debug", verdict: "npm run debug", kind: "command" })));
    expect(out).toContain("~/dev/dot");
    expect(out).not.toContain("→");
    expect(out.split("npm run debug").length - 1).toBe(1);
  });

  test("an agent resuming its own id says it once, not twice", () => {
    const w = row({ kind: "agent", flavour: "omp", detail: "abc-123", verdict: "omp --resume abc-123" });
    expect(plain(formatRow(w))).not.toContain("→");
  });

  test("shows the verdict when restore will do something else", () => {
    const out = plain(formatRow(row({ kind: "agent", detail: "(no session id)", verdict: "claude-work -c" })));
    expect(out).toContain("→ claude-work -c");
  });

  test("marks an unrestorable row", () => {
    const bad = row({ restorable: false, detail: "(no session id)", verdict: "plain shell — 2 candidates" });
    expect(plain(formatRow(bad)).startsWith("! ")).toBe(true);
    expect(plain(formatRow(row({}))).startsWith("  ")).toBe(true);
  });

  test("stays inside its column budget even with an absurd cwd and detail", () => {
    const long = formatRow(
      row({
        cwd: `/home/shad/${"deep/".repeat(30)}leaf`,
        detail: "x".repeat(200),
        verdict: "y".repeat(200),
        restorable: false,
      }),
    );
    // 88 leaves room for clack's seven columns of group chrome inside 100.
    expect(plain(long).length).toBeLessThanOrEqual(88);
    // The tail of the path is what identifies it, so that is the end that survives.
    expect(plain(long)).toContain("deep/leaf");
  });
});
