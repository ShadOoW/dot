import { defineCommand } from "citty";
import { confirm, isCancel } from "@clack/prompts";
import { liveSessionIds } from "../../lib/agents.ts";
import { colors, commandExists, logError, logInfo, logSuccess, logWarn } from "../../lib/console.ts";
import { notify } from "../../lib/kitty.ts";
import { detectInit } from "../../lib/pkg.ts";
import { buildRestorePlan, captureManifest, type Manifest } from "../../lib/session.ts";
import {
  armAutoRestore,
  autoRestoreArmed,
  claimAutoRestore,
  discardAutoRestore,
  disarmAutoRestore,
  LAST_SLOT,
  listSlots,
  readSlot,
  removeSlot,
  sanitizeSlotName,
  slotNameForSelector,
  writeSlot,
} from "../../lib/session-slots.ts";
import { recoverCommand } from "./recover.ts";
import { printPlan, runRestore } from "./restore.ts";
import { resolveSelection, summarize, type SelectArgs, type Selection } from "./shared.ts";

// `dot session` — what is open, saved as data, and put back later.
//
// Named `session` because that is what the rest of the world calls this: an
// X11/Wayland session manager saves and restores the set of running apps, and
// systemd already calls your login a session. The word is overloaded three ways
// in this repo, so the rule is: bare "session" always means the desktop
// session, and an agent's conversation is ALWAYS qualified — "agent session",
// or its id. The selector namespace does that work for free (`--only agent`).

const SELECT_ARGS = {
  all: { type: "boolean", description: "Skip the picker and take everything" },
  only: { type: "string", description: "Narrow to a selector: agent, agent:omp, command, shell, app" },
  except: { type: "string", description: "Drop matching windows" },
} as const;

/**
 * Reboot is init-specific: `systemctl` does not exist on the Void boot, and this
 * machine dual-boots. systemd reboots unprivileged through polkit; runit needs
 * root for shutdown(8).
 */
function rebootArgv(): string[] {
  if (detectInit() === "systemd") return ["systemctl", "reboot"];
  const priv = commandExists("doas") ? "doas" : "sudo";
  return [priv, "shutdown", "-r", "now"];
}

/**
 * Where a save lands. `last` is ALWAYS the complete capture, so a curated save
 * can never destroy the full safety net it was taken from; a partial or named
 * save additionally gets its own slot, and that is the one armed for login.
 */
async function persist(total: Manifest, chosen: Selection, asName: string | undefined): Promise<string> {
  await writeSlot(LAST_SLOT, total);
  const named = asName != null || chosen.selector != null;
  if (!named) {
    await armAutoRestore(LAST_SLOT);
    return LAST_SLOT;
  }
  let name: string | null;
  if (asName != null) {
    name = sanitizeSlotName(asName);
    if (!name) {
      logError(`"${asName}" is not a usable slot name — use letters, digits, dot, plus, dash or underscore`);
      process.exit(1);
    }
  } else {
    name = slotNameForSelector(chosen.selector);
  }
  await writeSlot(name, chosen.manifest);
  await armAutoRestore(name);
  return name;
}

const saveCommand = defineCommand({
  meta: { description: "Snapshot open windows and agent sessions into a slot" },
  args: {
    ...SELECT_ARGS,
    as: { type: "string", description: "Name the slot (default: derived from the selection)" },
    "dry-run": { type: "boolean", description: "Print what would be saved without writing" },
  },
  async run({ args }) {
    const total = await captureManifest();
    const chosen = await resolveSelection(total, args as SelectArgs, "Save which windows?");
    if (!chosen) return;

    if (args["dry-run"]) {
      summarize(chosen.manifest);
      logInfo("dry run — nothing written");
      return;
    }

    const slot = await persist(total, chosen, args.as);
    summarize(chosen.manifest);
    logSuccess(`Saved to slot ${colors.bold(slot)} — armed for the next login`);
    // Teach the flags from the picker: the equivalent command, printed once.
    if (!args.all && chosen.selector) {
      logInfo(colors.dim(`→ dot session save --all --only ${chosen.selector}`));
    }
  },
});

const rebootCommand = defineCommand({
  meta: { description: "Snapshot, then reboot — the snapshot restores on the next sway login" },
  args: {
    ...SELECT_ARGS,
    as: { type: "string", description: "Name the slot" },
    now: { type: "boolean", description: "Skip confirmation" },
  },
  async run({ args }) {
    const total = await captureManifest();
    const chosen = await resolveSelection(total, args as SelectArgs, "Save which windows before rebooting?");
    if (!chosen) return;
    summarize(chosen.manifest);

    if (!args.now) {
      const ok = await confirm({ message: "Save this snapshot and reboot now?" });
      if (isCancel(ok) || !ok) {
        logInfo("Aborted — nothing saved");
        return;
      }
    }
    const slot = await persist(total, chosen, args.as);
    logSuccess(`Snapshot saved to ${slot} — rebooting`);
    Bun.spawnSync(rebootArgv());
  },
});

/**
 * Slot chooser for a keybinding, replacing the workspace launcher's profile
 * menu — a saved slot is a project layout obtained by demonstration, so there is
 * nothing left to hand-author. Follows the fuzzel toggle convention (see
 * fuzzel-scripts/windows.sh): a second press of the key closes the menu.
 */
async function pickSlotWithFuzzel(): Promise<string | null> {
  if (Bun.spawnSync(["pkill", "-x", "fuzzel"]).exitCode === 0) return null;
  const slots = await listSlots();
  if (slots.length === 0) {
    notify("normal", "dot session", "No saved slots — run `dot session save`");
    return null;
  }
  const proc = Bun.spawn(["fuzzel", "--dmenu", "--prompt", "  Session  "], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin.write(slots.map((s) => `${s.name}: ${new Date(s.savedAt).toLocaleString()}`).join("\n"));
  await proc.stdin.end();
  const out = (await proc.stdout.text()).trim();
  await proc.exited;
  const name = out.split(":")[0]?.trim();
  return name && slots.some((s) => s.name === name) ? name : null;
}

const restoreCommand = defineCommand({
  meta: { description: "Rebuild a saved slot (non-destructive; runs from sway exec on login)" },
  args: {
    ...SELECT_ARGS,
    from: { type: "string", description: `Slot to restore (default ${LAST_SLOT})` },
    "if-pending": {
      type: "boolean",
      description: "Login one-shot: restore only if armed, consuming the trigger; silent otherwise",
    },
    pick: { type: "boolean", description: "Choose a slot with fuzzel; implies --all (for a keybinding)" },
    "dry-run": { type: "boolean", description: "Print the restore plan without launching anything" },
  },
  async run({ args }) {
    // Login path: fire exactly once per save via the auto-restore token, then
    // drop it. Slots are durable and are left in place. No picker here — this
    // runs unattended.
    if (args["if-pending"]) {
      const claimed = await claimAutoRestore();
      if (!claimed) return;
      await runRestore(claimed.manifest);
      await discardAutoRestore(claimed.claimedToken);
      return;
    }

    // --pick comes from a keybinding, where there is no terminal to prompt in,
    // so choosing the slot IS the interaction: restore all of it.
    let slot = args.from ?? LAST_SLOT;
    if (args.pick) {
      const picked = await pickSlotWithFuzzel();
      if (!picked) return;
      slot = picked;
      args.all = true;
    }
    const manifest = readSlot(slot);
    if (!manifest) {
      logError(`No slot "${slot}" — run \`dot session save\` first, or \`dot session list\``);
      process.exit(1);
    }

    // Here the live-session guard matters: it is what marks a session that is
    // already open as "skipped" instead of resuming a second writer onto it.
    const live = liveSessionIds();
    const chosen = await resolveSelection(manifest, args as SelectArgs, `Restore which windows from ${slot}?`, live);
    if (!chosen) return;

    if (args["dry-run"]) {
      // Same live-session guard the real restore uses. Without it the printed plan
      // shows windows that an actual restore would drop, which makes --dry-run a
      // liar about the one thing it exists to answer.
      printPlan(buildRestorePlan(chosen.manifest, live));
      return;
    }

    await runRestore(chosen.manifest);
    // A manual restore also disarms the login trigger, so the same layout does
    // not arrive twice. The slot itself survives for the next recovery.
    await disarmAutoRestore();
  },
});

const listCommand = defineCommand({
  meta: { description: "List saved slots" },
  async run() {
    const slots = await listSlots();
    if (slots.length === 0) {
      logInfo("No saved slots");
      return;
    }
    for (const s of slots) {
      const counts = Object.entries(s.counts)
        .map(([g, n]) => `${n} ${g}`)
        .join(colors.dim(" · "));
      const armed = s.armed ? colors.green(" armed") : "";
      console.log(`${colors.bold(s.name.padEnd(16))} ${new Date(s.savedAt).toLocaleString()}${armed}`);
      console.log(`  ${counts || colors.dim("empty")}`);
    }
  },
});

const statusCommand = defineCommand({
  meta: { description: "Show the armed slot and what is saved" },
  async run() {
    const armed = autoRestoreArmed();
    const slots = await listSlots();
    if (slots.length === 0) {
      logInfo("No saved slots");
      return;
    }
    logInfo(
      armed
        ? `${colors.green(armed)} is armed — it auto-restores on the next login`
        : colors.dim("nothing armed — the next login restores nothing"),
    );
    const target = readSlot(armed ?? LAST_SLOT);
    if (target) summarize(target, liveSessionIds());
    logInfo(colors.dim(`${slots.length} slot(s) — dot session list`));
  },
});

const clearCommand = defineCommand({
  meta: { description: "Discard a slot and disarm the login trigger" },
  args: {
    slot: { type: "positional", required: false, description: `Slot to drop (default ${LAST_SLOT})` },
    all: { type: "boolean", description: "Drop every slot" },
  },
  async run({ args }) {
    if (args.all) {
      const slots = await listSlots();
      for (const s of slots) await removeSlot(s.name);
      await disarmAutoRestore();
      logSuccess(`Dropped ${slots.length} slot(s)`);
      return;
    }
    const name = args.slot ?? LAST_SLOT;
    const dropped = await removeSlot(name);
    if (autoRestoreArmed() === name) await disarmAutoRestore();
    if (dropped) logSuccess(`Slot "${name}" cleared`);
    else logInfo(`No slot "${name}"`);
  },
});

export const sessionCommand = defineCommand({
  meta: { description: "Save the open desktop — terminals, agent sessions, layout — and restore it" },
  subCommands: {
    save: saveCommand,
    restore: restoreCommand,
    reboot: rebootCommand,
    recover: recoverCommand,
    list: listCommand,
    status: statusCommand,
    clear: clearCommand,
  },
});
