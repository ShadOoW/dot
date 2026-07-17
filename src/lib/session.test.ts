import { describe, expect, test } from "bun:test";
import { buildRestorePlan, classifyWindow, type Manifest } from "./session.ts";

describe("classifyWindow", () => {
  test("claude window: headroom wrapper + claude + mcp servers → claude with its pid", () => {
    expect(
      classifyWindow([
        { pid: 7770, cmdline: ["python3", "/home/shad/.local/bin/headroom", "wrap", "claude", "-c"] },
        { pid: 7781, cmdline: ["/home/shad/.bun/bin/claude", "--allow-dangerously-skip-permissions", "-c"] },
        { pid: 7810, cmdline: ["/home/shad/.cache/managed-fnm/aliases/default/bin/agentmemory-mcp"] },
      ]),
    ).toEqual({ kind: "claude", claudePid: 7781 });
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

  test("idle login shell → shell", () => {
    expect(classifyWindow([{ pid: 100, cmdline: ["-zsh"] }])).toEqual({ kind: "shell" });
  });

  test("empty/missing foreground list → shell", () => {
    expect(classifyWindow(undefined)).toEqual({ kind: "shell" });
    expect(classifyWindow([])).toEqual({ kind: "shell" });
  });
});

function manifestWith(windows: Manifest["osWindows"][0]["tabs"][0]["windows"]): Manifest {
  return {
    version: 1,
    savedAt: 0,
    focusedWorkspace: 4,
    osWindows: [{ kittyPid: 1, appId: "kitty", workspace: 4, tabs: [{ title: "t", windows }] }],
    skipped: { guiWindows: [], scratchpad: [] },
    claudeUnmatched: [],
  };
}

describe("buildRestorePlan", () => {
  test("claude with session id resumes exactly, in its own account", () => {
    const work = buildRestorePlan(
      manifestWith([{ cwd: "/data/ops", kind: "claude", claude: { sessionId: "abc-123", command: "claude-work" } }]),
    );
    expect(work.windows[0]!.tabs[0]!.windows[0]!.cmd).toBe("claude-work --resume abc-123");
    expect(work.claudeCount).toBe(1);

    const personal = buildRestorePlan(
      manifestWith([{ cwd: "/data/me", kind: "claude", claude: { sessionId: "def-456", command: "claude-personal" } }]),
    );
    expect(personal.windows[0]!.tabs[0]!.windows[0]!.cmd).toBe("claude-personal --resume def-456");
  });

  test("id-less claude falls back to -c (in its account) only when unique for its cwd", () => {
    const unique = buildRestorePlan(
      manifestWith([{ cwd: "/data/ops", kind: "claude", claude: { sessionId: null, command: "claude-personal" } }]),
    );
    expect(unique.windows[0]!.tabs[0]!.windows[0]!.cmd).toBe("claude-personal -c");

    const dupes = buildRestorePlan(
      manifestWith([
        { cwd: "/data/ops", kind: "claude", claude: { sessionId: null, command: "claude-work" } },
        { cwd: "/data/ops", kind: "claude", claude: { sessionId: null, command: "claude-work" } },
      ]),
    );
    expect(dupes.windows[0]!.tabs[0]!.windows.every((w) => w.cmd === undefined)).toBe(true);
    expect(dupes.notes.length).toBe(2);
  });

  test("commands re-run verbatim, shells stay plain, unmatched sessions get their own window", () => {
    const m = manifestWith([
      { cwd: "/x", kind: "command", command: ["npm", "run", "debug"] },
      { cwd: "/y", kind: "shell" },
    ]);
    m.claudeUnmatched = [{ sessionId: "zzz-999", cwd: "/data/config/dot", name: "dot-ef", command: "claude-work" }];
    const plan = buildRestorePlan(m);
    expect(plan.windows[0]!.tabs[0]!.windows[0]!.cmd).toBe("npm run debug");
    expect(plan.windows[0]!.tabs[0]!.windows[1]!.cmd).toBeUndefined();
    const extra = plan.windows.at(-1)!;
    expect(extra.appId).toBe("session-claude");
    expect(extra.tabs[0]!.windows[0]!.cmd).toBe("claude-work --resume zzz-999");
  });

  test("saved profile app_ids survive; bare kitty gets a session id", () => {
    const m = manifestWith([{ cwd: "/x", kind: "shell" }]);
    expect(buildRestorePlan(m).windows[0]!.appId).toBe("session-0");
    m.osWindows[0]!.appId = "ws-bruce-right";
    expect(buildRestorePlan(m).windows[0]!.appId).toBe("ws-bruce-right");
  });
});
