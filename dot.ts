#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import { pkgCommand } from "./src/commands/pkg.ts";
import { updateCommand } from "./src/commands/update.ts";
import { kernelCommand } from "./src/commands/kernel.ts";
import { assetsCommand } from "./src/commands/assets.ts";
import { docsCommand } from "./src/commands/docs.ts";
import { toolsCommand } from "./src/commands/tools/index.ts";
import { cacheCommand } from "./src/commands/cache.ts";
import { doctorCommand } from "./src/commands/doctor.ts";
import { graphCommand } from "./src/commands/graph.ts";
import { completionsCommand } from "./src/commands/completions.ts";

const main = defineCommand({
  meta: {
    name: "dot",
    description: "Dotfiles manager — link packages, update system, sync assets, run tools",
  },
  subCommands: {
    pkg: pkgCommand,
    update: updateCommand,
    kernel: kernelCommand,
    assets: assetsCommand,
    docs: docsCommand,
    tools: toolsCommand,
    cache: cacheCommand,
    doctor: doctorCommand,
    graph: graphCommand,
    completions: completionsCommand,
  },
});

runMain(main);
