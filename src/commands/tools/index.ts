import { defineCommand } from "citty";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { HOME_DIR } from "../../lib/config.ts";
import { colors, logInfo } from "../../lib/console.ts";
import { compressCommand } from "./compress.ts";
import { recordCommand } from "./record.ts";
import { passphraseCommand } from "./passphrase.ts";

const chroootCommand = defineCommand({
  meta: { description: "Display the Void Linux chroot recovery instructions" },
  async run() {
    const scriptPath = join(HOME_DIR, "shell/chroot-void.sh");
    console.log(`\n${colors.bold("Void Linux Chroot Recovery")}\n`);
    console.log("Run this from a live USB environment — NOT from within the running system.\n");
    console.log("─".repeat(60));
    if (existsSync(scriptPath)) {
      console.log(await readFile(scriptPath, "utf-8"));
    } else {
      logInfo("Script not found at ~/shell/chroot-void.sh");
      console.log(`
Manual steps:
  mount /dev/sdX1 /mnt/void          # mount root subvolume
  mount --bind /dev /mnt/void/dev
  mount --bind /proc /mnt/void/proc
  mount --bind /sys /mnt/void/sys
  chroot /mnt/void /bin/bash
`);
    }
  },
});

export const toolsCommand = defineCommand({
  meta: { description: "Development and system utilities" },
  subCommands: {
    compress: compressCommand,
    record: recordCommand,
    chroot: chroootCommand,
    passphrase: passphraseCommand,
  },
  async run() {
    console.log(`
Usage: dot tools <subcommand>

Subcommands:
  compress <input> [output]   Batch compress images (PNG, JPEG, WebP, GIF→WebP)
  record                     Record screen (Wayland/wf-recorder)
  chroot                      Show Void Linux chroot recovery instructions
  passphrase                  Generate a secure diceware passphrase

Examples:
  dot tools compress ~/screenshots/
  dot tools compress ~/photos/ ~/photos-compressed/ --quality high --dry-run
  dot tools record --mode monitor --quality high
  dot tools chroot
  dot tools passphrase --words 6
`);
  },
});
