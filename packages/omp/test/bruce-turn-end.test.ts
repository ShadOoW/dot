import { beforeEach, describe, expect, test } from 'bun:test';
import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';

import bruceTurnEnd, { advisoryText, fingerprint, inWorkspace, MAX_CHAIN, reasonOf } from '../hooks/pre/bruce-turn-end.ts';

const ROOT = '/ws';

interface Exec {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly killed?: boolean;
}
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

/** A fake `pi`: its handlers by event name, every `exec` call, every entry written, every warning shown. */
const harness = (script: (command: string, args: ReadonlyArray<string>) => Exec) => {
  const handlers = new Map<string, Handler>();
  const calls: string[][] = [];
  const entries: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    exec: async (command: string, args: string[]) => {
      calls.push([command, ...args]);
      const answer = script(command, args);
      return { stdout: answer.stdout ?? '', stderr: answer.stderr ?? '', code: answer.code ?? 0, killed: answer.killed ?? false };
    },
    appendEntry: (type: string, data: Record<string, unknown>) => {
      if (type === 'bruce-turn-end') entries.push(data);
    },
  };
  bruceTurnEnd(pi as unknown as ExtensionAPI);
  const ctx = { cwd: ROOT, ui: { notify: (message: string) => warnings.push(message) } };
  // Module state is shared between harnesses, as it is between a session and its children: each test starts a session.
  void handlers.get('session_start')?.({}, ctx);
  const fire = (name: string, event: unknown = {}): Promise<unknown> => {
    const handler = handlers.get(name);
    if (handler === undefined) throw new Error(`no handler for ${name}`);
    return handler(event, ctx);
  };
  const wrote = (path: string, toolName = 'write'): Promise<unknown> =>
    fire('tool_result', { toolName, isError: false, details: toolName === 'write' ? { resolvedPath: path } : { path, op: 'update' } });
  const stop = (active = false): Promise<unknown> =>
    fire('session_stop', { stop_hook_active: active, signal: new AbortController().signal });
  return { calls, entries, warnings, fire, wrote, stop };
};

const problem = (line: number, rule = 'toBeTruthy', path = 'app/client/web/code/src/a.test.ts') => ({
  path,
  line,
  rule,
  message: `${rule}: says a value is there`,
});
const lintOf = (problems: unknown[], files: unknown[] = [{ path: 'app/client/web/code/src/a.test.ts', kind: 'test', lane: 'app/client/web' }]) =>
  JSON.stringify({ files, problems });
const CLEAN = lintOf([]);

beforeEach(() => {
  process.env.BRUCELEE_ROOT = ROOT;
});

describe('what a session wrote', () => {
  test('a session that wrote nothing runs nothing and says so in the session file', async () => {
    const h = harness(() => ({ stdout: CLEAN }));
    expect(await h.stop()).toBeUndefined();
    expect(h.calls).toEqual([]);
    expect(h.entries[0]).toMatchObject({ touched: 0, commands: 0 });
  });

  test('an edit of two files records the one inside the workspace; a delete takes it back out; an error records nothing', async () => {
    const h = harness(() => ({ stdout: CLEAN }));
    await h.fire('session_start');
    await h.fire('tool_result', {
      toolName: 'edit',
      isError: false,
      details: { perFileResults: [{ path: '/ws/e2e/a.spec.ts', op: 'update' }, { path: '/etc/hosts', op: 'update' }] },
    });
    await h.fire('tool_result', { toolName: 'edit', isError: true, details: { path: '/ws/e2e/b.spec.ts', op: 'update' } });
    await h.stop();
    expect(h.calls[0]?.slice(4)).toEqual(['/ws/e2e/a.spec.ts']);

    await h.wrote('/ws/e2e/c.spec.ts');
    await h.fire('tool_result', { toolName: 'edit', isError: false, details: { path: '/ws/e2e/c.spec.ts', op: 'delete' } });
    h.calls.length = 0;
    await h.stop();
    expect(h.calls).toEqual([]);
  });

  test('a file in node_modules or .git is not the session\'s, and a sibling folder of the workspace is not in it', () => {
    expect(inWorkspace(ROOT, '/ws/e2e/a.spec.ts')).toBe(true);
    expect(inWorkspace(ROOT, '/ws/e2e/node_modules/x/a.spec.ts')).toBe(false);
    expect(inWorkspace(ROOT, '/ws/sms/.git/hooks/a.ts')).toBe(false);
    expect(inWorkspace(ROOT, '/ws-elsewhere/a.spec.ts')).toBe(false);
  });

  test('ast_edit and a shell leave no path to record', async () => {
    const h = harness(() => ({ stdout: CLEAN }));
    await h.fire('session_start');
    await h.fire('tool_result', { toolName: 'ast_edit', isError: false, details: {} });
    await h.fire('tool_result', { toolName: 'bash', isError: false, details: { path: '/ws/e2e/a.spec.ts' } });
    await h.stop();
    expect(h.calls).toEqual([]);
  });

  test('a file outside the workspace is never recorded', async () => {
    const h = harness(() => ({ stdout: CLEAN }));
    await h.fire('session_start');
    await h.wrote('/tmp/x.spec.ts');
    await h.fire('tool_result', { toolName: 'write', isError: false, details: { resolvedPath: '/ws-elsewhere/x.spec.ts' } });
    await h.stop();
    expect(h.calls).toEqual([]);
    expect(h.entries[0]).toMatchObject({ touched: 0, commands: 0 });
  });
});

describe('what a problem does', () => {
  test('a problem returns to the session with its file, line, rule and message, and the way out', async () => {
    const h = harness(() => ({ stdout: lintOf([problem(7)]) }));
    await h.fire('session_start');
    await h.wrote('/ws/app/client/web/code/src/a.test.ts');
    const stop = (await h.stop()) as { decision: string; reason: string };
    expect(stop.decision).toBe('block');
    expect(stop.reason).toContain('app/client/web/code/src/a.test.ts:7  toBeTruthy — toBeTruthy: says a value is there');
    expect(stop.reason).toContain('after 2 refusals');
    expect(h.entries[0]).toMatchObject({ refused: true, problems: 1, commands: 1 });
  });

  test('the same problems on moved lines are refused twice and then released with a warning', async () => {
    let line = 7;
    const h = harness(() => ({ stdout: lintOf([problem((line += 1))]) }));
    await h.fire('session_start');
    await h.wrote('/ws/app/client/web/code/src/a.test.ts');
    expect(await h.stop()).toHaveProperty('decision', 'block');
    expect(await h.stop(true)).toHaveProperty('decision', 'block');
    expect(await h.stop(true)).toBeUndefined();
    expect(h.warnings[0]).toContain('still open');
    expect(h.entries[2]).toMatchObject({ released: true });
    // Released: nothing is recorded any more, so the next stop runs nothing.
    h.calls.length = 0;
    expect(await h.stop()).toBeUndefined();
    expect(h.calls).toEqual([]);
  });

  test('a problem set that changes every time is released at the chain\'s own cap', async () => {
    let n = 0;
    const h = harness(() => ({ stdout: lintOf([problem(1, `rule-${String((n += 1))}`)]) }));
    await h.fire('session_start');
    await h.wrote('/ws/app/client/web/code/src/a.test.ts');
    for (let i = 0; i < MAX_CHAIN; i += 1) expect(await h.stop(i > 0)).toHaveProperty('decision', 'block');
    expect(await h.stop(true)).toBeUndefined();
    expect(h.entries.at(-1)).toMatchObject({ released: true });
  });

  test('a stop that is not a continuation starts a new chain', async () => {
    let n = 0;
    const h = harness(() => ({ stdout: lintOf([problem(1, `rule-${String((n += 1))}`)]) }));
    await h.fire('session_start');
    await h.wrote('/ws/app/client/web/code/src/a.test.ts');
    for (let i = 0; i < MAX_CHAIN; i += 1) await h.stop(i > 0);
    // A fresh user turn: the same file is still recorded only if nothing released it.
    expect(await h.stop(false)).toHaveProperty('decision', 'block');
  });

  test('a clean lint finishes, and the next stop runs nothing', async () => {
    const h = harness(() => ({ stdout: CLEAN }));
    await h.fire('session_start');
    await h.wrote('/ws/app/client/web/code/src/a.test.ts');
    expect(await h.stop()).toBeUndefined();
    h.calls.length = 0;
    expect(await h.stop()).toBeUndefined();
    expect(h.calls).toEqual([]);
  });
});

describe('a check that cannot run never blocks', () => {
  for (const [label, answer, shown] of [
    ['killed by the budget', { killed: true, code: -1 }, 'timed out after 20 s'],
    ['a non-zero exit', { code: 1, stderr: 'brucelee: command not found\nmore' }, 'brucelee: command not found'],
    ['output that is not the result', { stdout: 'not json' }, 'not the lint result'],
    ['JSON that is not the result', { stdout: '{"files": 3}' }, 'not the lint result'],
  ] as const) {
    test(label, async () => {
      const h = harness(() => answer);
      await h.fire('session_start');
      await h.wrote('/ws/app/client/web/code/src/a.test.ts');
      expect(await h.stop()).toBeUndefined();
      expect(h.warnings[0]).toContain(shown);
      expect(h.entries[0]).toMatchObject({ failed: 'lint' });
    });
  }
});

describe('the specs that import a changed source file', () => {
  const COVERING = JSON.stringify({
    lanes: [{ repo: 'app/client/web', specs: ['code/src/Frame/Date/bounds.test.ts', 'code/src/b.test.ts'], narrowed: true }],
  });
  const SOURCE = [{ path: 'app/client/web/code/src/Frame/Date/bounds.ts', kind: 'source', lane: 'app/client/web' }];
  const scripted = (covering: Exec) => (_c: string, args: ReadonlyArray<string>): Exec =>
    args[1] === 'covering' ? covering : { stdout: lintOf([], SOURCE) };

  test('a clean lint names them once, with the command, and not again for the same files', async () => {
    const h = harness(scripted({ stdout: COVERING }));
    await h.fire('session_start');
    await h.wrote('/ws/app/client/web/code/src/Frame/Date/bounds.ts');
    const first = (await h.stop()) as { continue: boolean; additionalContext: string };
    expect(first.continue).toBe(true);
    expect(first.additionalContext).toContain(
      'cd /ws/app/client/web/code && npx vitest run --silent=true src/Frame/Date/bounds.test.ts src/b.test.ts',
    );
    expect(h.calls.filter((c) => c[2] === 'covering')).toHaveLength(1);
    expect(h.entries[0]).toMatchObject({ commands: 2, advised: true });

    await h.wrote('/ws/app/client/web/code/src/Frame/Date/bounds.ts');
    expect(await h.stop()).toBeUndefined();
  });

  test('a lane every spec reaches prints its reason and no command', () => {
    const text = advisoryText(ROOT, [
      { lane: 'app/client/web', paths: ['p.ts'], specs: [], narrowed: false, reason: 'every test file loads it through src/tests.setup.ts' },
    ]);
    expect(text).toContain('app/client/web — every test file loads it through src/tests.setup.ts');
    expect(text).not.toContain('npx vitest');
  });

  test('more specs than are shown say how many are left and how to ask', () => {
    const specs = Array.from({ length: 12 }, (_, i) => `code/src/s${String(i)}.test.ts`);
    const text = advisoryText(ROOT, [{ lane: 'app/client/web', paths: ['p.ts'], specs, narrowed: true }]);
    expect(text).toContain('… and 2 more (brucelee ticket covering p.ts)');
    expect(text).not.toContain('s10.test.ts');
  });

  test('a covering answer that fails changes nothing about the lint\'s verdict', async () => {
    const h = harness(scripted({ code: 1, stderr: 'boom' }));
    await h.fire('session_start');
    await h.wrote('/ws/app/client/web/code/src/Frame/Date/bounds.ts');
    expect(await h.stop()).toBeUndefined();
    expect(h.warnings).toEqual([]);
  });
});

describe('the pieces', () => {
  test('a refusal lists at most twenty problems and counts the rest', () => {
    const many = Array.from({ length: 23 }, (_, i) => problem(i + 1));
    const reason = reasonOf(many, '');
    expect(reason).toContain('found 23 problem(s)');
    expect(reason).toContain('… and 3 more');
    expect(reason).not.toContain(':21 ');
  });

  test('the fingerprint ignores line numbers', () => {
    expect(fingerprint([problem(3)])).toBe(fingerprint([problem(30)]));
    expect(fingerprint([problem(3)])).not.toBe(fingerprint([problem(3, 'fixed sleep')]));
  });

  test('session_start forgets what was recorded', async () => {
    const h = harness(() => ({ stdout: CLEAN }));
    await h.wrote('/ws/app/client/web/code/src/a.test.ts');
    await h.fire('session_start');
    expect(await h.stop()).toBeUndefined();
    expect(h.calls).toEqual([]);
  });
});
