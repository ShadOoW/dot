import { liveSessionIds } from "../../lib/agents.ts";
import { colors, logInfo, logSuccess, logWarn } from "../../lib/console.ts";
import { buildSessionFile, writeSessionFile } from "../../lib/kitty-session.ts";
import { notify } from "../../lib/kitty.ts";
import { buildRestorePlan, type Manifest, type RestorePlan } from "../../lib/session.ts";
import { shellEscape } from "../../lib/spawn.ts";
import { applyLayout } from "../../lib/sway-layout.ts";
import { allNodes, getTree, swayCommand, WindowSubscription } from "../../lib/sway.ts";

const WAIT_MS = 15000;

/**
 * --single-instance makes each restored window an os-window of the one running
 * kitty process — ~29 ms instead of the ~590 ms a cold kitty spends on its
 * Python imports — while --app-id, --directory and --session still apply per
 * window, which is what the sway-side app_id matching depends on.
 */
const KITTY_LAUNCH = ["kitty", "--single-instance"];

function spawnDetached(argv: string[]): void {
  Bun.spawn(argv, { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref();
}

export function printPlan(plan: RestorePlan): void {
  for (const w of plan.windows) {
    console.log(`${colors.bold(w.appId)} → workspace ${w.workspace ?? "current"}`);
    console.log(buildSessionFile(w.tabs).replace(/^/gm, "  "));
  }
  for (const app of plan.apps) {
    const where = `workspace ${app.workspace ?? "current"}`;
    console.log(`${colors.bold(app.appId ?? "(no app_id)")} → ${where}: exec ${app.argv?.join(" ")}`);
  }
  for (const note of plan.notes) logWarn(note);
}

/**
 * Rebuild a saved manifest. Non-destructive and idempotent: an app_id already on
 * screen is adopted rather than launched again, which is what makes a partial
 * restore safe to reach for casually. Without that guard a second restore would
 * resume a live agent session a second time, leaving two processes appending to
 * one transcript.
 */
export async function runRestore(m: Manifest): Promise<void> {
  const plan = buildRestorePlan(m, liveSessionIds());
  for (const note of plan.notes) logWarn(note);

  const present = new Map<string, number>();
  for (const n of allNodes(await getTree())) if (n.app_id) present.set(n.app_id, n.id);

  // Only windows launched by THIS run may be handed to the layout pass. The
  // planner is pure and cannot see an existing container, so re-placing an
  // adopted window wraps it a second time — an already-correct tabbed group
  // comes back as a tabbed group inside a tabbed group, two stacked tab bars.
  //
  // Keyed by the con_id each window had AT CAPTURE, because app_id does not
  // identify a window: every bare kitty os-window reports `kitty`, so the
  // arrangement that matters most — a tabbed stack of agent terminals — is
  // invisible to an app_id match. app_id remains the fallback for GUI windows.
  const byCaptureId = new Map<number, number>();
  const byAppId = new Map<string, number>();
  let launchedCount = 0;
  let adopted = 0;
  const sub = await WindowSubscription.open();
  let failures = 0;
  try {
    const ordered = [...plan.windows].sort((a, b) => (a.workspace ?? 99) - (b.workspace ?? 99));
    for (const w of ordered) {
      const existing = present.get(w.appId);
      if (existing != null) {
        adopted++;
        logInfo(`${w.appId} already open — adopted`);
        continue;
      }
      if (w.workspace != null) await swayCommand(`workspace number ${w.workspace}`);
      const file = await writeSessionFile(w.appId, buildSessionFile(w.tabs));
      spawnDetached([...KITTY_LAUNCH, "--app-id", w.appId, "--session", file]);
      const node = await sub.waitFor(w.appId, WAIT_MS);
      if (!node) {
        logWarn(`Timed out waiting for ${w.appId}`);
        failures++;
        continue;
      }
      launchedCount++;
      if (w.conId != null) byCaptureId.set(w.conId, node.id);
      byAppId.set(w.appId, node.id);
      // A focus race during startup can land the window elsewhere — pin it.
      if (w.workspace != null) {
        await swayCommand(`[con_id=${node.id}] move container to workspace number ${w.workspace}`);
      }
    }

    for (const app of plan.apps) {
      // buildRestorePlan already dropped unrestorable apps; narrow anyway so the
      // key handed to sway is provably real.
      if (!app.appId || !app.argv?.length) continue;
      const existing = present.get(app.appId);
      if (existing != null) {
        adopted++;
        continue;
      }
      if (app.workspace != null) await swayCommand(`workspace number ${app.workspace}`);
      await swayCommand(`exec ${shellEscape(app.argv)}`);
      const node = await sub.waitFor(app.appId, WAIT_MS);
      if (node) {
        launchedCount++;
        if (app.conId != null) byCaptureId.set(app.conId, node.id);
        byAppId.set(app.appId, node.id);
      } else {
        logWarn(`Timed out waiting for GUI app ${app.appId}`);
      }
    }

    // Nothing fresh means every window is already in a layout of its own; a
    // rebuild here could only damage it.
    if (m.layout && launchedCount > 0) {
      const resolve = (win: { conId: number | null; appId: string | null }): number | null =>
        (win.conId != null ? byCaptureId.get(win.conId) : undefined) ??
        (win.appId != null ? byAppId.get(win.appId) : undefined) ??
        null;
      for (const note of await applyLayout(m.layout, resolve)) logWarn(note);
    } else if (m.layout && adopted > 0) {
      logInfo(colors.dim("layout left alone — every window was already open"));
    }
  } finally {
    sub.close();
  }

  if (m.focusedWorkspace != null) await swayCommand(`workspace number ${m.focusedWorkspace}`);

  const summary = `${plan.windows.length - failures}/${plan.windows.length} windows, ${plan.agentCount} agent session(s)`;
  if (failures > 0) {
    notify("critical", "Session restore incomplete", summary);
    logWarn(`Restore incomplete: ${summary}`);
  } else {
    notify("normal", "Session restored", summary);
    logSuccess(`Restored ${summary}`);
  }
}
