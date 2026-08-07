import { defineCommand } from "citty";
import { sessionCommand } from "./session.ts";

export const claudeCommand = defineCommand({
  meta: { description: "Snapshot/restore kitty windows and their Claude Code sessions" },
  subCommands: {
    session: sessionCommand,
  },
});
