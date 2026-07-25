import { defineCommand } from "citty";
import { createInterface } from "readline";
import { commandExists, logError, logInfo, logSection, logSuccess, logWarn } from "../lib/console.ts";

const KEEP_COUNT = 2;

export const kernelCommand = defineCommand({
  meta: { description: "Remove old Void Linux kernels, keeping the 2 newest" },
  args: {
    check: { type: "boolean", description: "Show what would be removed without making changes" },
    yes: { type: "boolean", description: "Skip confirmation prompt" },
  },
  async run({ args }) {
    if (!commandExists("vkpurge")) {
      logWarn("vkpurge: not found — is this a Void Linux system?");
      return;
    }

    const raw = Bun.spawnSync(["vkpurge", "list"], { stdout: "pipe", stderr: "pipe" });
    const all = new TextDecoder().decode(raw.stdout).trim().split("\n").filter(Boolean);

    // /boot is shared with Arch Linux. Arch kernels appear in vkpurge output as
    // "linux" and "linux-zen". Void kernel entries are bare version strings (e.g. "6.12.30_1").
    // Never allow any entry starting with "linux" to be touched.
    const archKernels = all.filter((k) => k.startsWith("linux"));
    const voidKernels = all.filter((k) => !k.startsWith("linux"));

    const sortResult = Bun.spawnSync(["sort", "-V"], {
      stdin: new TextEncoder().encode(voidKernels.join("\n")),
      stdout: "pipe",
    });
    const sorted = new TextDecoder().decode(sortResult.stdout).trim().split("\n").filter(Boolean);

    const toKeep = sorted.slice(-KEEP_COUNT);
    const toRemove = sorted.slice(0, -KEEP_COUNT);

    logSection("kernels");

    for (const k of archKernels) {
      logInfo(`${k}  — arch, skipped`);
    }
    for (const k of toRemove) {
      logInfo(`${k}  — remove`);
    }
    for (const k of toKeep) {
      logSuccess(`${k}  — keep`);
    }

    if (toRemove.length === 0) {
      logSuccess("nothing to remove");
      return;
    }

    if (args.check) return;

    process.stdout.write(`\n  Remove ${toRemove.length} old Void kernel${toRemove.length > 1 ? "s" : ""}? [y/N] `);

    if (!args.yes) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => rl.question("", resolve));
      rl.close();
      if (answer.trim().toLowerCase() !== "y") {
        logWarn("aborted");
        return;
      }
    } else {
      process.stdout.write("y\n");
    }

    const purge = Bun.spawnSync(["sudo", "vkpurge", "rm", ...toRemove], { stdout: "inherit", stderr: "inherit" });
    if (purge.exitCode !== 0) {
      logError(`vkpurge rm failed (exit ${purge.exitCode}) — skipping grub-mkconfig`);
      process.exit(1);
    }
    const grub = Bun.spawnSync(["sudo", "grub-mkconfig", "-o", "/boot/grub/grub.cfg"], { stdout: "inherit", stderr: "inherit" });
    if (grub.exitCode !== 0) {
      logError(`grub-mkconfig failed (exit ${grub.exitCode})`);
      process.exit(1);
    }
    logSuccess("done");
  },
});
