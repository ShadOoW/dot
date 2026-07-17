import { defineCommand } from "citty";
import { sendCommand } from "./send.ts";
import { sessionCommand } from "./session.ts";

export const claudeCommand = defineCommand({
  meta: { description: "Talk to Claude Code kitty windows and snapshot/restore their sessions" },
  subCommands: {
    send: sendCommand,
    session: sessionCommand,
  },
});
