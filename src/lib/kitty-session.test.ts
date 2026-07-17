import { describe, expect, test } from "bun:test";
import { buildSessionFile, launchArgv } from "./kitty-session.ts";

describe("kitty-session", () => {
  test("plain shell window launches a bare login shell", () => {
    expect(launchArgv({ cwd: "/data/config/dot" })).toEqual(["zsh", "-l"]);
  });

  test("commands are wrapped to survive exit and keep login env", () => {
    expect(launchArgv({ cwd: "/x", cmd: "npm run debug" })).toEqual([
      "zsh",
      "-l",
      "-c",
      "npm run debug; exec zsh -l",
    ]);
  });

  test("session file emits new_tab/cd/launch per window", () => {
    const out = buildSessionFile([
      {
        title: "debug",
        windows: [
          { cwd: "/data/code/app", cmd: "npm run debug" },
          { cwd: "/data/code/app" },
        ],
      },
      { title: "shell", windows: [{ cwd: "/data/config/dot" }] },
    ]);
    expect(out).toBe(
      [
        "new_tab debug",
        "cd /data/code/app",
        "launch zsh -l -c 'npm run debug; exec zsh -l'",
        "cd /data/code/app",
        "launch zsh -l",
        "new_tab shell",
        "cd /data/config/dot",
        "launch zsh -l",
        "",
      ].join("\n"),
    );
  });

  test("single quotes in commands survive shlex quoting", () => {
    const out = buildSessionFile([
      { title: "t", windows: [{ cwd: "/x", cmd: "echo 'it works'" }] },
    ]);
    expect(out).toContain(`launch zsh -l -c 'echo '\\''it works'\\''; exec zsh -l'`);
  });

  test("claude resume commands pass through unmangled", () => {
    const out = buildSessionFile([
      {
        title: "claude",
        windows: [{ cwd: "/x", cmd: "claude-work --resume 110537b6-9b9a-479b-98b0-3f7b8ca37cf3" }],
      },
    ]);
    expect(out).toContain(
      "launch zsh -l -c 'claude-work --resume 110537b6-9b9a-479b-98b0-3f7b8ca37cf3; exec zsh -l'",
    );
  });
});
