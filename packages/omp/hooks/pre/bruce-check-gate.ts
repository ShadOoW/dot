// The hidden-check gate: a session that changed the Bruce client while its branch names a ticket with a hidden
// check may not finish until that check has graded the work as it stands, and the developer sees the verdict.
//
// Why: a ticket's check (`brucelee ticket check`, logos `apps/brucelee/lib/check.ts`) is the proof that the bug it
// was written for is fixed, and the session changing the code is the one that cannot read it. A skill telling that
// session to run it reaches only sessions that load the skill; this runs at every turn's end instead. METR's 2025
// reward-hacking report measured that telling a model how to behave changed almost nothing, so the run is required
// here, not asked for.
//
// WHAT IT DOES. When a prompt starts in the workspace it asks `brucelee ticket verdict --json` for the client lane's
// tree id (one read, about 0.3 s, not awaited). It also records whether an `edit` or `write` landed in the lane, so a
// session whose cwd is elsewhere still counts. At `session_stop` it asks again: when the tree is the one the prompt
// started on and nothing was written, it does nothing and says nothing. Otherwise:
//   - the branch names no ticket, or the ticket has no check: it lets the session finish and says so to the developer;
//   - the last verdict was given on exactly this tree: a pass lets it finish and is shown to the developer; a fail
//     is refused with the failing row's title and the first paragraph of its assertion — the words the check prints;
//   - no verdict on this tree: refused, with the one command to run.
// It never runs the check itself: a run takes about two minutes against the 30 s a handler is allowed. The session
// runs it, and `ticket check` records the verdict against the tree's id, which is what the next stop reads.
//
// WHAT IT PROMISES. A session that changed the lane does not end silently: either it finishes on a pass for the work
// as it stands, or the developer is shown why it finished without one. The refusals are capped (`MAX_SAME` per
// unchanged tree and state, `MAX_CHAIN` per stop): omp keeps a `block` "blocking until the hook allows completion",
// so the caps are this file's own. A gate that cannot read the verdict says so with a warning and never blocks.
// Every stop that had work to judge writes a `bruce-check-gate` entry into the session file.
//
// WHAT IT DOES NOT BOUND. Lanes other than the client: the check can serve only the client today. A subagent's own
// stop (omp fires `session_stop` for the main session only; a subagent's writes are judged at its parent's stop).
// Claude Code. A session ended by interrupt. Ignored files, which the tree id does not cover.
//
// A regular file, never a link: omp's hook loader skips symlinked files (the package README, "Hooks").

import { isAbsolute, resolve } from 'node:path';

import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';

const DEFAULT_ROOT = '/data/code/work/bruce';
/** The one lane `ticket check` can serve. */
export const LANE = 'app/client/web';
/** The 30 s handler budget, less the work around the call. */
export const BUDGET_MS = 20_000;
/** Refusals of one unchanged tree in one state before the session is let through. */
export const MAX_SAME = 2;
/** Refusals in one stop chain before the session is let through, whatever the state. */
export const MAX_CHAIN = 4;

/** The last verdict `ticket check` recorded, narrowed to what this file reads. */
export interface LastVerdict {
  readonly tree: string;
  readonly verdict: 'pass' | 'fail';
  readonly test?: string;
  readonly assertion?: string;
  readonly gradedAt: string;
}

/** What `brucelee ticket verdict --json` answers, narrowed to what this file reads. */
export interface VerdictState {
  readonly repo: string;
  readonly branch: string;
  readonly key?: string;
  readonly check: boolean;
  readonly tree: string;
  readonly last?: LastVerdict;
  readonly current: boolean;
}

/** A decoded JSON value checked to be an object, whose fields are still to be checked one by one. */
type Untrusted<T> = { readonly [K in keyof T]?: unknown };

/** The reading when `text` is one, `undefined` otherwise: a gate that cannot read its answer says so. */
export const parseVerdict = (text: string): VerdictState | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { repo, branch, key, check, tree, last, current } = parsed as Untrusted<VerdictState>;
  if (typeof repo !== 'string' || typeof branch !== 'string' || typeof tree !== 'string') return undefined;
  if (typeof check !== 'boolean' || typeof current !== 'boolean') return undefined;
  let lastVerdict: LastVerdict | undefined;
  if (typeof last === 'object' && last !== null) {
    const recorded = last as Untrusted<LastVerdict>;
    if (typeof recorded.tree !== 'string' || typeof recorded.gradedAt !== 'string') return undefined;
    if (recorded.verdict !== 'pass' && recorded.verdict !== 'fail') return undefined;
    lastVerdict = {
      tree: recorded.tree,
      verdict: recorded.verdict,
      gradedAt: recorded.gradedAt,
      ...(typeof recorded.test === 'string' ? { test: recorded.test } : {}),
      ...(typeof recorded.assertion === 'string' ? { assertion: recorded.assertion } : {}),
    };
  }
  return {
    repo,
    branch,
    check,
    tree,
    current,
    ...(typeof key === 'string' ? { key } : {}),
    ...(lastVerdict === undefined ? {} : { last: lastVerdict }),
  };
};

/** What the gate decides at one stop, before the caps. */
export type Decision =
  | { readonly kind: 'quiet' }
  | { readonly kind: 'let-through'; readonly tone: 'info' | 'warning'; readonly note: string }
  | { readonly kind: 'refuse'; readonly state: 'owed' | 'fail'; readonly reason: string; readonly onRelease: string };

const clock = (iso: string): string => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const RUN = '`brucelee ticket check`';
const HANDS_OFF =
  "Never look for, open or search the check's files: the command is the only way to it, and it prints all a " +
  'session may know.';

/**
 * The decision for one stop, given whether the session changed the lane and where the lane stands. Pure: the caps
 * and every side effect are the handler's.
 */
export const decide = (changed: boolean, s: VerdictState): Decision => {
  if (!changed) return { kind: 'quiet' };
  const where = `${s.repo} on ${s.branch === '' ? 'a detached HEAD' : s.branch}`;
  if (s.key === undefined) {
    return { kind: 'let-through', tone: 'info', note: `Hidden check: none — ${where} names no ticket, so nothing graded this change.` };
  }
  if (!s.check) {
    return { kind: 'let-through', tone: 'info', note: `Hidden check: none — ${s.key} has no hidden check, so nothing graded this change (${where}).` };
  }
  if (s.current && s.last?.verdict === 'pass') {
    return {
      kind: 'let-through',
      tone: 'info',
      note: `Hidden check ${s.key}: PASS on the work as it stands (graded ${clock(s.last.gradedAt)}, ${where}).`,
    };
  }
  if (s.current && s.last?.verdict === 'fail') {
    const row = s.last.test ?? 'a row of the check';
    return {
      kind: 'refuse',
      state: 'fail',
      reason: [
        `The hidden check for ${s.key} FAILS on the work as it stands (${where}):`,
        `  ${row}`,
        ...(s.last.assertion === undefined ? [] : [`  ${s.last.assertion}`]),
        `Fix your change, then run ${RUN} again and finish only once it passes. ${HANDS_OFF}`,
        'If the failure is not yours to fix, stop and tell the developer the failing row above; after ' +
          `${String(MAX_SAME)} refusals of the same tree you are let through.`,
      ].join('\n'),
      onRelease: `Hidden check ${s.key}: FAIL — the session finished with the check failing on the work as it stands: ${row}.`,
    };
  }
  const stale =
    s.last === undefined
      ? 'It has not graded this work yet.'
      : `Its last verdict (${s.last.verdict}, ${clock(s.last.gradedAt)}) was on another state of the work.`;
  return {
    kind: 'refuse',
    state: 'owed',
    reason: [
      `You changed ${where}, and ticket ${s.key} has a hidden check that grades this work. ${stale}`,
      `Run ${RUN} with no arguments: it reads the ticket off the branch, grades the working tree as it stands, and ` +
        'takes about two minutes (it waits if another check is running). Then finish, and give its verdict line in ' +
        `your reply. ${HANDS_OFF}`,
      'If it cannot run (it prints why and exits 2), say so in your reply.',
    ].join('\n'),
    onRelease: `Hidden check ${s.key}: NOT RUN — the session finished without grading its changes (${where}).`,
  };
};

/** Under the lane, and not in a dependency folder or git's own. */
export const inLane = (root: string, path: string): boolean => {
  const prefix = `${root}/${LANE}/`;
  return path.startsWith(prefix) && !path.slice(prefix.length).split('/').some((s) => s === 'node_modules' || s === '.git');
};

/** One written file in an `edit` result's details. */
interface EditedFile {
  readonly path: string;
  readonly sourcePath?: string;
}

/** The paths a tool result wrote. `ast_edit` and a shell carry none: the tree id catches those. */
export const writtenBy = (event: { readonly toolName: string; readonly details?: unknown }): ReadonlyArray<string> => {
  const details = event.details;
  if (typeof details !== 'object' || details === null) return [];
  const fields = details as Untrusted<{ resolvedPath: string; perFileResults: unknown[] }>;
  if (event.toolName === 'write') return typeof fields.resolvedPath === 'string' ? [fields.resolvedPath] : [];
  if (event.toolName !== 'edit') return [];
  const rows: unknown[] = Array.isArray(fields.perFileResults) ? fields.perFileResults : [details];
  const written: string[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const file = row as Untrusted<EditedFile>;
    if (typeof file.path !== 'string') continue;
    written.push(file.path);
    if (typeof file.sourcePath === 'string') written.push(file.sourcePath);
  }
  return written;
};

// Module-level, because a child session shares the module with its parent (`omp://extensions.md`, "Runtime model"):
// what a subagent writes is the prompt's work. Reset by `session_start`, `session_switch` and every stop let through.
let baseline: Promise<string | undefined> | undefined;
let touched = false;
const refusals = new Map<string, number>();
let chain = 0;

const settle = (): void => {
  baseline = undefined;
  touched = false;
  refusals.clear();
  chain = 0;
};

export default function bruceCheckGate(pi: ExtensionAPI): void {
  const root = (): string => process.env.BRUCELEE_ROOT ?? DEFAULT_ROOT;
  const ask = async (signal: AbortSignal): Promise<{ state?: VerdictState; why?: string }> => {
    const answer = await pi.exec('brucelee', ['ticket', 'verdict', '--json'], { cwd: root(), signal });
    if (answer.killed) return { why: `timed out after ${String(BUDGET_MS / 1000)} s` };
    const state = answer.code === 0 ? parseVerdict(answer.stdout) : undefined;
    if (state !== undefined) return { state };
    return { why: answer.stderr.split('\n').find((l) => l.trim() !== '')?.trim() || 'its answer was not the reading' };
  };

  pi.on('session_start', async () => {
    settle();
  });
  pi.on('session_switch', async () => {
    settle();
  });

  // Not awaited: the prompt starts at once, and the stop awaits the answer.
  pi.on('agent_start', async (_event, ctx) => {
    const base = root();
    if (baseline !== undefined || (ctx.cwd !== base && !ctx.cwd.startsWith(`${base}/`))) return;
    baseline = ask(AbortSignal.timeout(BUDGET_MS)).then((a) => a.state?.tree);
  });

  pi.on('tool_result', async (event, ctx) => {
    if (event.isError) return undefined;
    for (const path of writtenBy(event)) {
      if (inLane(root(), isAbsolute(path) ? path : resolve(ctx.cwd, path))) touched = true;
    }
    return undefined;
  });

  pi.on('session_stop', async (event, ctx) => {
    const started = Date.now();
    const entry = (data: Record<string, unknown>): void => {
      pi.appendEntry('bruce-check-gate', { ms: Date.now() - started, ...data });
    };
    if (!event.stop_hook_active) chain = 0;
    if (baseline === undefined && !touched) return undefined;

    const signal = AbortSignal.any([event.signal, AbortSignal.timeout(BUDGET_MS)]);
    const [before, now] = await Promise.all([baseline ?? Promise.resolve(undefined), ask(signal)]);
    if (now.state === undefined) {
      ctx.ui.notify(`Hidden check gate did not run: ${now.why ?? 'no answer'}`, 'warning');
      entry({ failed: now.why });
      settle();
      return undefined;
    }
    const state = now.state;
    // An unreadable baseline proves nothing about the tree: only a recorded write counts then.
    const changed = touched || (before !== undefined && before !== state.tree);
    const decision = decide(changed, state);
    if (decision.kind === 'quiet') {
      settle();
      return undefined;
    }
    if (decision.kind === 'let-through') {
      ctx.ui.notify(decision.note, decision.tone);
      entry({ key: state.key, tree: state.tree, verdict: state.current ? state.last?.verdict : undefined, let: true });
      settle();
      return undefined;
    }
    const seen = `${decision.state}|${state.tree}`;
    if ((refusals.get(seen) ?? 0) >= MAX_SAME || chain >= MAX_CHAIN) {
      ctx.ui.notify(decision.onRelease, decision.state === 'fail' ? 'error' : 'warning');
      entry({ key: state.key, tree: state.tree, state: decision.state, released: true, chain });
      settle();
      return undefined;
    }
    refusals.set(seen, (refusals.get(seen) ?? 0) + 1);
    chain += 1;
    entry({ key: state.key, tree: state.tree, state: decision.state, refused: true, chain });
    return { decision: 'block' as const, reason: decision.reason };
  });
}
