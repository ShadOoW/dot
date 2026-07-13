import { defineCommand } from "citty";
import { logError, logSuccess, logWarn } from "../../lib/console.ts";
import { findClaudeWindows, sendEnter, sendText } from "../../lib/kitty.ts";
import { run } from "../../lib/spawn.ts";

/**
 * Send text into the Claude Code session running in a kitty window for the
 * current repo. This is the dispatch half of the nvim review loop: review.nvim
 * exports annotations to the clipboard, <leader>rs pipes them here, and the
 * agent gets them as its next prompt.
 *
 *   echo "fix the error handling in api.ts" | dot tools claude-send
 *   dot tools claude-send --text "..." --no-enter
 */

async function gitRoot(): Promise<string> {
  const r = await run(["git", "rev-parse", "--show-toplevel"]);
  return r.exitCode === 0 ? r.stdout.trim() : process.cwd();
}

export const claudeSendCommand = defineCommand({
  meta: {
    name: "claude-send",
    description: "Send text (stdin or --text) to this repo's Claude Code kitty window",
  },
  args: {
    text: { type: "string", description: "Text to send (default: read from stdin)" },
    match: { type: "string", description: "Substring to disambiguate windows by title/cwd" },
    "no-enter": { type: "boolean", description: "Paste the text without submitting it" },
  },
  async run({ args }) {
    const text = (args.text ?? (await Bun.stdin.text())).trimEnd();
    if (!text) {
      logError("Nothing to send (empty stdin and no --text)");
      process.exit(1);
    }

    const root = await gitRoot();
    const windows = await findClaudeWindows(args.match);
    // Never target the claude session this command was spawned from — an
    // agent piping to claude-send must not prompt itself into a loop.
    const others = windows.filter((w) => !w.isSelf);
    let candidates = others.filter((w) => w.cwd === root);
    if (candidates.length === 0) {
      candidates = others.filter((w) => w.cwd.startsWith(`${root}/`) || root.startsWith(`${w.cwd}/`));
    }

    if (candidates.length === 0) {
      logError(`No Claude Code window found for ${root}`);
      process.exit(1);
    }
    if (candidates.length > 1) {
      logWarn(`Multiple Claude windows match ${root} — narrow it down with --match:`);
      for (const w of candidates) logWarn(`  ${w.cwd}  (${w.title})`);
      process.exit(1);
    }

    const target = candidates[0]!;
    const sent = await sendText(target.socket, target.windowId, text);
    if (!sent) {
      logError("kitten send-text failed");
      process.exit(1);
    }
    if (!args["no-enter"]) {
      // Let the TUI ingest the paste before the key event so Enter isn't
      // coalesced into it (same trick as claude-resume-runner).
      await Bun.sleep(400);
      if (!(await sendEnter(target.socket, target.windowId))) {
        logError("kitten send-key failed — text pasted but not submitted");
        process.exit(1);
      }
    }
    logSuccess(`Sent ${text.length} chars to ${target.title || target.cwd}`);
  },
});
