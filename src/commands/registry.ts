import { pkgCommand } from "./pkg.ts";
import { updateCommand } from "./update.ts";
import { kernelCommand } from "./kernel.ts";
import { assetsCommand } from "./assets.ts";
import { docsCommand } from "./docs.ts";
import { toolsCommand } from "./tools/index.ts";
import { cacheCommand } from "./cache.ts";
import { doctorCommand } from "./doctor.ts";
import { statusCommand } from "./status.ts";
import { graphCommand } from "./graph.ts";
import { completionsCommand } from "./completions.ts";
import { sgcCommand } from "./sgc.ts";
import { claudeCommand } from "./claude/index.ts";
import { cueCommand } from "./cue/index.ts";
import { sweepCommand } from "./sweep.ts";

// Single source of truth for top-level commands: dot.ts registers these with
// citty and completions.ts derives the zsh completion list from the same map,
// so the two can never drift apart.
//
// completions.ts also imports this module (an ESM cycle). That is safe only
// because completions.ts touches REGISTRY inside generateZsh() at command
// time, never at module top level — keep it that way.
export const REGISTRY = {
  pkg: pkgCommand,
  update: updateCommand,
  kernel: kernelCommand,
  assets: assetsCommand,
  docs: docsCommand,
  tools: toolsCommand,
  cache: cacheCommand,
  status: statusCommand,
  doctor: doctorCommand,
  graph: graphCommand,
  completions: completionsCommand,
  sgc: sgcCommand,
  claude: claudeCommand,
  cue: cueCommand,
  sweep: sweepCommand,
};
