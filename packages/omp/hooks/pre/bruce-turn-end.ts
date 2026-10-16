// The turn-end check: a session that wrote test files in the Bruce workspace may not finish while the weak-test
// lint is red on the lines its branch added to them.
//
// Why: Thoughtworks' Radar ("feedback sensors for coding agents", Trial, April 2026), OpenAI's harness engineering
// and Böckeler all put deterministic checks inside the session, before a commit, rather than after it. A check an
// agent never sees changes nothing, and the lint behind this one (`brucelee ticket lint`, test-quality 08) used to
// be read only by whoever ran `ticket tests` afterwards. So the hook runs it on the files the session wrote, when
// the session is about to settle, and gives the reply back to the same session as a refusal to finish.
//
// WHAT IT DOES. It records every path a successful `edit` or `write` touches under the workspace, from the tool
// results (not from `git status`: the developer's own uncommitted work is in that tree, and is not this session's).
// A subagent's writes count: its results reach this handler and the state below is shared (measured 2026-10-16, a main
// session that only called `task` stopped with its subagent's file recorded).
// At `session_stop`, with nothing recorded it does nothing and runs nothing. Otherwise it runs `brucelee ticket lint`
// over the recorded paths and, when a problem comes back, returns `{ decision: "block", reason }`: the session
// continues with each problem's file, line, rule and message. The lint charges only lines the branch added — in a
// file the developer also edited, the developer's lines count too — and `e2e/`, which has its own repository, is
// read against its own `HEAD`. If the session changed source files, the reason (or, with no problem, an advisory
// continuation) also names the specs that import them and the command that runs them. It does not run them: the
// covering run measured 98.7 s against the 30 s a handler is allowed.
//
// WHAT IT PROMISES. A weak-test problem on a line the branch added, in a file the session wrote through
// `edit`/`write`, is put in front of the session before it may finish: at most twice per unchanged problem set
// and six times per stop. omp counts a `block` against no cap and keeps it "blocking until the hook allows
// completion", so the caps are this file's own (`MAX_SAME`, `MAX_CHAIN`). A check that cannot run — brucelee
// missing, the 20 s budget spent, output that is not the result — says so with a warning and never blocks.
// Every stop writes a `bruce-turn-end` entry into the session file, so "ran nothing" and every refusal can be read
// back with `jq -c 'select(.customType=="bruce-turn-end").data' <session file>`.
//
// WHAT IT DOES NOT BOUND. A file written by a shell or by `ast_edit` (its result carries no path); a problem no rule
// names; the lines of other people in the same file; a session that ends by interrupt; Claude Code, which this
// plan's checks do not reach (test-quality 03). A false positive is let through by giving the reason in the reply:
// after two refusals of the same problems the session is released.
//
// A regular file, never a link: omp's hook loader skips symlinked files (the package README, "Hooks").

import { isAbsolute, resolve } from 'node:path';

import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';

const DEFAULT_ROOT = '/data/code/work/bruce';
/** The 30 s handler budget, less the work around the call. */
export const BUDGET_MS = 20_000;
/** Refusals of one unchanged problem set before the session is let through. */
export const MAX_SAME = 2;
/** Refusals in one stop chain before the session is let through, whatever the problems. */
export const MAX_CHAIN = 6;
/** Specs a covering line names before it says how many more. */
export const SPECS_SHOWN = 10;
/** Problems a refusal lists before it says how many more. */
const PROBLEMS_SHOWN = 20;
/** Lanes asked about their covering specs in one stop. */
const LANES_ASKED = 3;

/** What `brucelee ticket lint --json` answers, narrowed to what this file reads. */
export interface Problem {
  readonly path: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}
export interface LintedRow {
  readonly path: string;
  readonly kind: string;
  readonly lane: string | null;
}
export interface LintOutput {
  readonly files: ReadonlyArray<LintedRow>;
  readonly problems: ReadonlyArray<Problem>;
}

/** One lane's covering answer, with the paths it was asked about. */
export interface Covering {
  readonly lane: string;
  readonly paths: ReadonlyArray<string>;
  readonly specs: ReadonlyArray<string>;
  readonly narrowed: boolean;
  readonly reason?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The lint result when `text` is one, `undefined` otherwise: a check that cannot read its answer says so. */
export const parseLint = (text: string): LintOutput | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.files) || !Array.isArray(parsed.problems)) return undefined;
  const files: LintedRow[] = [];
  for (const f of parsed.files as unknown[]) {
    if (!isRecord(f) || typeof f.path !== 'string' || typeof f.kind !== 'string') return undefined;
    files.push({ path: f.path, kind: f.kind, lane: typeof f.lane === 'string' ? f.lane : null });
  }
  const problems: Problem[] = [];
  for (const p of parsed.problems as unknown[]) {
    if (!isRecord(p) || typeof p.path !== 'string' || typeof p.line !== 'number') return undefined;
    if (typeof p.rule !== 'string' || typeof p.message !== 'string') return undefined;
    problems.push({ path: p.path, line: p.line, rule: p.rule, message: p.message });
  }
  return { files, problems };
};

/** The lanes of a covering answer, each tagged with the paths asked; anything else is nothing. */
export const parseCovering = (text: string, paths: ReadonlyArray<string>): ReadonlyArray<Covering> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.lanes)) return [];
  const lanes: Covering[] = [];
  for (const l of parsed.lanes as unknown[]) {
    if (!isRecord(l) || typeof l.repo !== 'string' || !Array.isArray(l.specs) || typeof l.narrowed !== 'boolean') continue;
    const specs = l.specs.filter((s): s is string => typeof s === 'string');
    lanes.push({
      lane: l.repo,
      paths,
      specs,
      narrowed: l.narrowed,
      ...(typeof l.reason === 'string' ? { reason: l.reason } : {}),
    });
  }
  return lanes;
};

/** A problem set's identity: no line numbers, because fixing one problem moves the ones below it. */
export const fingerprint = (problems: ReadonlyArray<Problem>): string =>
  problems
    .map((p) => `${p.path}|${p.rule}|${p.message}`)
    .sort()
    .join('\n');

/** The covering answers as the one thing a session needs: which specs to run, and the command. */
export const advisoryText = (root: string, covering: ReadonlyArray<Covering>): string => {
  const lines: string[] = [];
  for (const c of covering) {
    if (c.narrowed && c.specs.length > 0) {
      const shown = c.specs.slice(0, SPECS_SHOWN).map((s) => s.replace(/^code\//u, ''));
      const more = c.specs.length - shown.length;
      lines.push(
        `${c.lane} — ${String(c.specs.length)} spec(s) import the source files you changed: ` +
          `cd ${root}/${c.lane}/code && npx vitest run --silent=true ${shown.join(' ')}` +
          (more > 0 ? ` … and ${String(more)} more (brucelee ticket covering ${c.paths.join(' ')})` : ''),
      );
    } else if (c.reason !== undefined) {
      lines.push(`${c.lane} — ${c.reason}`);
    }
  }
  return lines.length === 0 ? '' : ['You changed source files; run the specs that import them before you finish.', ...lines].join('\n');
};

/** The model-visible refusal: each problem, what to do, and the covering text when there is one. */
export const reasonOf = (problems: ReadonlyArray<Problem>, covering: string): string => {
  const listed = problems.slice(0, PROBLEMS_SHOWN).map((p) => `  ${p.path}:${String(p.line)}  ${p.rule} — ${p.message}`);
  if (problems.length > PROBLEMS_SHOWN) listed.push(`  … and ${String(problems.length - PROBLEMS_SHOWN)} more`);
  return [
    `The weak-test lint found ${String(problems.length)} problem(s) on lines your branch added to files you edited:`,
    ...listed,
    'Fix each one in the file, then finish. If one is a false positive, give the reason in your reply; ' +
      `the check lets you through after ${String(MAX_SAME)} refusals of the same problems.`,
    ...(covering === '' ? [] : ['', covering]),
  ].join('\n');
};

/** The paths a tool result wrote, and whether each is gone. `ast_edit` and a shell carry none. */
export const writtenBy = (event: {
  readonly toolName: string;
  readonly details?: unknown;
}): ReadonlyArray<{ readonly path: string; readonly gone: boolean }> => {
  const details = event.details;
  if (!isRecord(details)) return [];
  if (event.toolName === 'write') {
    return typeof details.resolvedPath === 'string' ? [{ path: details.resolvedPath, gone: false }] : [];
  }
  if (event.toolName !== 'edit') return [];
  const rows: unknown[] = Array.isArray(details.perFileResults) ? (details.perFileResults as unknown[]) : [details];
  const written: Array<{ path: string; gone: boolean }> = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row.path !== 'string') continue;
    written.push({ path: row.path, gone: row.op === 'delete' });
    // A move leaves nothing at the old path.
    if (typeof row.sourcePath === 'string') written.push({ path: row.sourcePath, gone: true });
  }
  return written;
};

/** Under the workspace, and not in a dependency folder or git's own. */
export const inWorkspace = (root: string, path: string): boolean =>
  path.startsWith(`${root}/`) && !path.slice(root.length + 1).split('/').some((s) => s === 'node_modules' || s === '.git');

// Module-level, because a child session shares the module with its parent (`omp://extensions.md`, "Runtime model"):
// what a subagent writes is the turn's work. All four are reset by `session_start` and `session_switch`.
const touched = new Set<string>();
const refusals = new Map<string, number>();
const advised = new Set<string>();
let chain = 0;

const reset = (): void => {
  touched.clear();
  refusals.clear();
  advised.clear();
  chain = 0;
};

const firstLine = (text: string): string => text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';

export default function bruceTurnEnd(pi: ExtensionAPI): void {
  const root = (): string => process.env.BRUCELEE_ROOT ?? DEFAULT_ROOT;

  pi.on('session_start', async () => {
    reset();
  });
  pi.on('session_switch', async () => {
    reset();
  });

  pi.on('tool_result', async (event, ctx) => {
    if (event.isError) return undefined;
    for (const { path, gone } of writtenBy(event)) {
      const absolute = isAbsolute(path) ? path : resolve(ctx.cwd, path);
      if (gone) touched.delete(absolute);
      else if (inWorkspace(root(), absolute)) touched.add(absolute);
    }
    return undefined;
  });

  pi.on('session_stop', async (event, ctx) => {
    const started = Date.now();
    const base = root();
    const entry = (data: Record<string, unknown>): void => {
      pi.appendEntry('bruce-turn-end', { touched: touched.size, ms: Date.now() - started, ...data });
    };
    if (!event.stop_hook_active) chain = 0;
    if (touched.size === 0) {
      entry({ commands: 0 });
      return undefined;
    }

    const count = touched.size;
    const paths = [...touched];
    const signal = AbortSignal.any([event.signal, AbortSignal.timeout(BUDGET_MS)]);
    const lint = await pi.exec('brucelee', ['ticket', 'lint', '--json', ...paths], { cwd: base, signal });
    let commands = 1;
    const result = lint.killed || lint.code !== 0 ? undefined : parseLint(lint.stdout);
    if (result === undefined) {
      const why = lint.killed ? `timed out after ${String(BUDGET_MS / 1000)} s` : firstLine(lint.stderr) || 'its answer was not the lint result';
      ctx.ui.notify(`turn-end check did not run: ${why}`, 'warning');
      touched.clear();
      entry({ touched: count, commands, failed: 'lint' });
      return undefined;
    }

    // Advisory only: every failure here is silent and shows in the entry's command count.
    const sources = new Map<string, string[]>();
    for (const f of result.files) {
      if (f.kind === 'source' && f.lane !== null && f.lane !== 'e2e') sources.set(f.lane, [...(sources.get(f.lane) ?? []), f.path]);
    }
    const asked = [...sources.entries()].slice(0, LANES_ASKED);
    commands += asked.length;
    const answers = await Promise.all(
      asked.map(async ([, lanePaths]) => {
        const answer = await pi.exec('brucelee', ['ticket', 'covering', '--json', ...lanePaths], { cwd: base, signal });
        return answer.killed || answer.code !== 0 ? [] : parseCovering(answer.stdout, lanePaths);
      }),
    );
    const covering = answers.flat();
    const text = advisoryText(base, covering);
    const coveringKey = covering.map((c) => `${c.lane}|${c.specs.join(',')}`).sort().join('\n');

    const problems = result.problems;
    if (problems.length === 0) {
      touched.clear();
      refusals.clear();
      chain = 0;
      if (text !== '' && !advised.has(coveringKey)) {
        advised.add(coveringKey);
        entry({ touched: count, commands, problems: 0, advised: true });
        return { continue: true, additionalContext: text };
      }
      entry({ touched: count, commands, problems: 0 });
      return undefined;
    }

    const key = fingerprint(problems);
    if ((refusals.get(key) ?? 0) >= MAX_SAME || chain >= MAX_CHAIN) {
      ctx.ui.notify(`${String(problems.length)} lint problem(s) still open after ${String(chain)} refusals; the session was let through`, 'warning');
      touched.clear();
      refusals.clear();
      chain = 0;
      entry({ touched: count, commands, problems: problems.length, released: true });
      return undefined;
    }
    refusals.set(key, (refusals.get(key) ?? 0) + 1);
    chain += 1;
    // The session has read the covering text in this refusal; it is not repeated when the lint is clean.
    if (text !== '') advised.add(coveringKey);
    entry({ touched: count, commands, problems: problems.length, refused: true });
    return { decision: 'block' as const, reason: reasonOf(problems, text) };
  });
}
