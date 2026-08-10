import { describe, expect, test } from "bun:test";
import { buildRestorePlan, classifyWindow, type AgentRef, type Manifest, type ManifestWindow } from "./session.ts";

describe("classifyWindow", () => {
  test("claude window: headroom wrapper + claude + mcp servers → claude with its pid", () => {
    expect(
      classifyWindow([
        { pid: 7770, cmdline: ["python3", "/home/shad/.local/bin/headroom", "wrap", "claude", "-c"] },
        { pid: 7781, cmdline: ["/home/shad/.bun/bin/claude", "--allow-dangerously-skip-permissions", "-c"] },
        { pid: 7810, cmdline: ["/home/shad/.cache/managed-fnm/aliases/default/bin/agentmemory-mcp"] },
      ]),
    ).toEqual({ kind: "agent", agentPid: 7781, agentId: "claude" });
  });

  // The regression that motivated the adapter table: only claude ships as an ELF
  // binary, so an argv[0] test demotes every other agent to a generic command and
  // "restore" then starts a fresh one with an empty context.
  test("omp window: bun interpreter in argv[0] still classifies as an agent", () => {
    expect(classifyWindow([{ pid: 17590, cmdline: ["bun", "/home/shad/.bun/bin/omp"] }])).toEqual({
      kind: "agent",
      agentPid: 17590,
      agentId: "omp",
    });
  });

  test("dev server: shell + npm tree → command with the parent argv", () => {
    expect(
      classifyWindow([
        { pid: 100, cmdline: ["-zsh"] },
        { pid: 4000, cmdline: ["npm", "run", "debug"] },
        { pid: 4020, cmdline: ["node", "/x/node_modules/.bin/vite", "--port", "8080"] },
      ]),
    ).toEqual({ kind: "command", command: ["npm", "run", "debug"] });
  });

  test("an agent's name merely appearing in an argument is not an agent", () => {
    expect(classifyWindow([{ pid: 200, cmdline: ["nvim", "src/omp.ts"] }])).toEqual({
      kind: "command",
      command: ["nvim", "src/omp.ts"],
    });
  });

  test("idle login shell → shell", () => {
    expect(classifyWindow([{ pid: 100, cmdline: ["-zsh"] }])).toEqual({ kind: "shell" });
  });

  test("empty/missing foreground list → shell", () => {
    expect(classifyWindow(undefined)).toEqual({ kind: "shell" });
    expect(classifyWindow([])).toEqual({ kind: "shell" });
  });
});

function manifestWith(windows: ManifestWindow[]): Manifest {
  return {
    version: 2,
    savedAt: 0,
    focusedWorkspace: 4,
    osWindows: [{ kittyPid: 1, conId: 11, appId: "kitty", workspace: 4, tabs: [{ title: "t", windows }] }],
    apps: [],
    layout: null,
    agentsOrphaned: [],
    skipped: { scratchpad: [] },
  };
}

const agentWindow = (cwd: string, agent: AgentRef): ManifestWindow => ({ cwd, kind: "agent", agent });

describe("buildRestorePlan", () => {
  test("an agent with a session id resumes exactly, in its own account", () => {
    const work = buildRestorePlan(
      manifestWith([agentWindow("/data/ops", { agent: "claude", command: "claude-work", sessionId: "abc-123" })]),
    );
    expect(work.windows[0]!.tabs[0]!.windows[0]!.cmd).toBe("claude-work --resume abc-123");
    expect(work.agentCount).toBe(1);

    const personal = buildRestorePlan(
      manifestWith([agentWindow("/data/me", { agent: "claude", command: "claude-personal", sessionId: "def-456" })]),
    );
    expect(personal.windows[0]!.tabs[0]!.windows[0]!.cmd).toBe("claude-personal --resume def-456");
  });

  test("each agent resumes with its own flag, not claude's", () => {
    const plan = buildRestorePlan(
      manifestWith([agentWindow("/data/lake", { agent: "omp", command: "omp", sessionId: "019fe752" })]),
    );
    expect(plan.windows[0]!.tabs[0]!.windows[0]!.cmd).toBe("omp -r 019fe752");
  });

  test("an id-less agent continues only when it is alone in its cwd", () => {
    const unique = buildRestorePlan(
      manifestWith([agentWindow("/data/ops", { agent: "claude", command: "claude-personal", sessionId: null })]),
    );
    expect(unique.windows[0]!.tabs[0]!.windows[0]!.cmd).toBe("claude-personal -c");

    const dupes = buildRestorePlan(
      manifestWith([
        agentWindow("/data/ops", { agent: "claude", command: "claude-work", sessionId: null }),
        agentWindow("/data/ops", { agent: "claude", command: "claude-work", sessionId: null }),
      ]),
    );
    expect(dupes.windows[0]!.tabs[0]!.windows.every((w) => w.cmd === undefined)).toBe(true);
    expect(dupes.notes.length).toBe(2);
  });

  // Two different agents in one directory do not compete for "the newest session
  // here" — they read different stores — so keying the collision rule on cwd
  // alone would downgrade both of them for no reason.
  test("two different agents in one cwd both still continue", () => {
    const plan = buildRestorePlan(
      manifestWith([
        agentWindow("/data/ops", { agent: "claude", command: "claude-work", sessionId: null }),
        agentWindow("/data/ops", { agent: "omp", command: "omp", sessionId: null }),
      ]),
    );
    expect(plan.windows[0]!.tabs[0]!.windows.map((w) => w.cmd)).toEqual(["claude-work -c", "omp -c"]);
    expect(plan.notes).toEqual([]);
  });

  // Resuming a session that is already open would leave two processes appending
  // to one transcript. Opening a bare terminal in its place is no better — it is
  // litter — so the window is dropped and the emptied os-window with it, which is
  // what makes restoring an untouched slot twice a genuine no-op.
  test("a session that is already running gets no window at all", () => {
    const plan = buildRestorePlan(
      manifestWith([agentWindow("/data/ops", { agent: "omp", command: "omp", sessionId: "live-1" })]),
      new Set(["live-1"]),
    );
    expect(plan.windows).toEqual([]);
    expect(plan.agentCount).toBe(0);
    expect(plan.notes[0]).toContain("already running");
  });

  test("a live session is dropped without taking its tab-mates with it", () => {
    const plan = buildRestorePlan(
      manifestWith([
        agentWindow("/data/ops", { agent: "omp", command: "omp", sessionId: "live-1" }),
        { cwd: "/x", kind: "command", command: ["npm", "run", "debug"] },
      ]),
      new Set(["live-1"]),
    );
    expect(plan.windows[0]!.tabs[0]!.windows.map((w) => w.cmd)).toEqual(["npm run debug"]);
  });

  test("commands re-run verbatim, shells stay plain, orphaned sessions get their own window", () => {
    const m = manifestWith([
      { cwd: "/x", kind: "command", command: ["npm", "run", "debug"] },
      { cwd: "/y", kind: "shell" },
    ]);
    m.agentsOrphaned = [
      { agent: "claude", command: "claude-work", sessionId: "zzz-999", name: "dot-ef", cwd: "/data/config/dot" },
    ];
    const plan = buildRestorePlan(m);
    expect(plan.windows[0]!.tabs[0]!.windows[0]!.cmd).toBe("npm run debug");
    expect(plan.windows[0]!.tabs[0]!.windows[1]!.cmd).toBeUndefined();
    const extra = plan.windows.at(-1)!;
    expect(extra.appId).toBe("session-agents");
    expect(extra.tabs[0]!.windows[0]!.cmd).toBe("claude-work --resume zzz-999");
  });

  test("an orphan that is already running is not given a window", () => {
    const m = manifestWith([{ cwd: "/y", kind: "shell" }]);
    m.agentsOrphaned = [{ agent: "omp", command: "omp", sessionId: "live-2", cwd: "/data/lake" }];
    const plan = buildRestorePlan(m, new Set(["live-2"]));
    expect(plan.windows.some((w) => w.appId === "session-agents")).toBe(false);
    expect(plan.agentCount).toBe(0);
  });

  test("only GUI apps that can actually be relaunched survive into the plan", () => {
    const m = manifestWith([{ cwd: "/x", kind: "shell" }]);
    m.apps = [
      { appId: "insomnia", conId: null, workspace: 3, argv: ["insomnia"] },
      { appId: "ghost", conId: null, workspace: 3, argv: null },
      { appId: null, conId: null, workspace: 3, argv: ["some-xwayland-thing"] },
    ];
    expect(buildRestorePlan(m).apps.map((a) => a.appId)).toEqual(["insomnia"]);
  });

  test("saved profile app_ids survive; bare kitty gets a session id", () => {
    const m = manifestWith([{ cwd: "/x", kind: "shell" }]);
    expect(buildRestorePlan(m).windows[0]!.appId).toBe("session-0");
    m.osWindows[0]!.appId = "ws-bruce-right";
    expect(buildRestorePlan(m).windows[0]!.appId).toBe("ws-bruce-right");
  });
});
