import { beforeEach, describe, expect, test } from 'bun:test';
import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';

import bruceCheckGate, { MAX_SAME } from '../hooks/pre/bruce-check-gate.ts';

const ROOT = '/ws';

interface Exec {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly killed?: boolean;
}
type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;

/**
 * A fake `pi` whose `brucelee ticket verdict --json` answers whatever `reading.current` holds when it is asked, so a
 * test moves the lane by assigning it. Every notification and every exec is kept.
 */
const harness = (cwd = ROOT) => {
  const handlers = new Map<string, Handler>();
  const calls: string[][] = [];
  const notes: Array<{ message: string; type: string | undefined }> = [];
  const reading: { current: Exec } = { current: { code: 1, stderr: 'not set' } };
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, handler),
    exec: async (command: string, args: string[]) => {
      calls.push([command, ...args]);
      const answer = reading.current;
      return { stdout: answer.stdout ?? '', stderr: answer.stderr ?? '', code: answer.code ?? 0, killed: answer.killed ?? false };
    },
    appendEntry: () => undefined,
  };
  bruceCheckGate(pi as unknown as ExtensionAPI);
  const ctx = { cwd, ui: { notify: (message: string, type?: string) => notes.push({ message, type }) } };
  const fire = (name: string, event: unknown = {}): Promise<unknown> => {
    const handler = handlers.get(name);
    if (handler === undefined) throw new Error(`no handler for ${name}`);
    return handler(event, ctx);
  };
  void fire('session_start');
  const prompt = (): Promise<unknown> => fire('agent_start');
  const stop = (active = false): Promise<unknown> => fire('session_stop', { stop_hook_active: active, signal: new AbortController().signal });
  const wrote = (path: string): Promise<unknown> => fire('tool_result', { toolName: 'write', isError: false, details: { resolvedPath: path } });
  return { calls, notes, reading, prompt, stop, wrote };
};

const verdict = (fields: Record<string, unknown>): Exec => ({
  stdout: JSON.stringify({
    repo: 'app/client/web',
    lane: '/ws/app/client/web',
    branch: 'BRC-9103-viviers',
    key: 'BRC-9103',
    check: true,
    tree: 'aaa',
    current: false,
    ...fields,
  }),
});
const PASS = { tree: 'bbb', verdict: 'pass', e2e: 'e', gradedAt: '2026-10-17T16:58:02.265Z' };
const FAIL = { ...PASS, verdict: 'fail', test: '[R1] the pool page counts its talents', assertion: 'Error: expect(locator).toHaveText(expected) failed' };

beforeEach(() => {
  process.env.BRUCELEE_ROOT = ROOT;
});

describe('a prompt that did not change the lane', () => {
  test('is let through without a word, even on a branch whose check never graded the tree', async () => {
    const h = harness();
    h.reading.current = verdict({ tree: 'aaa' });
    await h.prompt();
    expect(await h.stop()).toBeUndefined();
    expect(h.notes).toEqual([]);
  });

  test('a session that never started a prompt in the workspace and wrote nothing there runs nothing', async () => {
    const h = harness('/elsewhere');
    await h.prompt();
    await h.wrote('/elsewhere/a.ts');
    expect(await h.stop()).toBeUndefined();
    expect(h.calls).toEqual([]);
  });
});

describe('a prompt that changed the lane', () => {
  test('with no verdict on the tree as it stands, it may not finish until the check is run', async () => {
    const h = harness();
    h.reading.current = verdict({ tree: 'aaa' });
    await h.prompt();
    h.reading.current = verdict({ tree: 'bbb' });
    const answer = (await h.stop()) as { decision: string; reason: string };
    expect(answer.decision).toBe('block');
    expect(answer.reason).toContain('`brucelee ticket check`');
    expect(answer.reason).toContain('BRC-9103');
  });

  test('a verdict recorded on another state of the work does not count', async () => {
    const h = harness();
    h.reading.current = verdict({ tree: 'aaa' });
    await h.prompt();
    h.reading.current = verdict({ tree: 'ccc', last: PASS });
    expect(await h.stop()).toMatchObject({ decision: 'block' });
  });

  test('a pass on the tree as it stands lets it finish and shows the developer the verdict', async () => {
    const h = harness();
    h.reading.current = verdict({ tree: 'aaa' });
    await h.prompt();
    h.reading.current = verdict({ tree: 'bbb' });
    await h.stop();
    h.reading.current = verdict({ tree: 'bbb', last: PASS, current: true });
    expect(await h.stop(true)).toBeUndefined();
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]?.message).toStartWith('Hidden check BRC-9103: PASS on the work as it stands');
  });

  test('a fail on the tree as it stands is refused with the failing row, then let through with an error the developer sees', async () => {
    const h = harness();
    h.reading.current = verdict({ tree: 'aaa' });
    await h.prompt();
    h.reading.current = verdict({ tree: 'bbb', last: FAIL, current: true });
    for (let i = 0; i < MAX_SAME; i += 1) {
      const answer = (await h.stop(i > 0)) as { reason: string };
      expect(answer.reason).toContain('[R1] the pool page counts its talents');
    }
    expect(await h.stop(true)).toBeUndefined();
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]?.type).toBe('error');
    expect(h.notes[0]?.message).toStartWith('Hidden check BRC-9103: FAIL');
  });

  test('a session that keeps stopping without running the check is let through, and the developer is told it was not run', async () => {
    const h = harness();
    h.reading.current = verdict({ tree: 'aaa' });
    await h.prompt();
    h.reading.current = verdict({ tree: 'bbb' });
    for (let i = 0; i < MAX_SAME; i += 1) expect(await h.stop(i > 0)).toMatchObject({ decision: 'block' });
    expect(await h.stop(true)).toBeUndefined();
    expect(h.notes[0]).toMatchObject({ type: 'warning' });
    expect(h.notes[0]?.message).toContain('NOT RUN');
  });

  test('a write into the lane counts even when the prompt started outside the workspace', async () => {
    const h = harness('/elsewhere');
    await h.prompt();
    await h.wrote('/ws/app/client/web/code/src/a.ts');
    h.reading.current = verdict({ tree: 'bbb' });
    expect(await h.stop()).toMatchObject({ decision: 'block' });
  });

  test('a branch that names no ticket is let through, and the developer is told nothing graded it', async () => {
    const h = harness();
    h.reading.current = verdict({ tree: 'aaa', branch: 'development', key: undefined, check: false });
    await h.prompt();
    h.reading.current = verdict({ tree: 'bbb', branch: 'development', key: undefined, check: false });
    expect(await h.stop()).toBeUndefined();
    expect(h.notes[0]?.message).toContain('names no ticket');
  });

  test('a ticket with no check is let through, and the developer is told nothing graded it', async () => {
    const h = harness();
    h.reading.current = verdict({ tree: 'aaa', check: false });
    await h.prompt();
    h.reading.current = verdict({ tree: 'bbb', check: false });
    expect(await h.stop()).toBeUndefined();
    expect(h.notes[0]?.message).toContain('BRC-9103 has no hidden check');
  });
});

describe('a gate that cannot read the verdict', () => {
  test('never blocks, and says why', async () => {
    const h = harness();
    await h.wrote('/ws/app/client/web/code/src/a.ts');
    h.reading.current = { code: 2, stderr: 'no runtime directory\nmore' };
    expect(await h.stop()).toBeUndefined();
    expect(h.notes).toEqual([{ message: 'Hidden check gate did not run: no runtime directory', type: 'warning' }]);
  });

  test('an unreadable baseline proves no change: without a write in the lane the prompt is let through quietly', async () => {
    const h = harness();
    h.reading.current = { code: 2, stderr: 'down' };
    await h.prompt();
    h.reading.current = verdict({ tree: 'bbb' });
    expect(await h.stop()).toBeUndefined();
    expect(h.notes).toEqual([]);
  });
});
