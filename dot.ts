#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import { REGISTRY } from "./src/commands/registry.ts";

const main = defineCommand({
  meta: {
    name: "dot",
    description: "Dotfiles manager — link packages, update system, sync assets, run tools",
  },
  subCommands: REGISTRY,
});

runMain(main);
