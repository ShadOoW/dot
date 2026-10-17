import { describe, expect, test } from 'bun:test';
import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';

import helperGuard, { type Helper, judge } from '../hooks/pre/helper-guard.ts';

const ok = (helper: Helper, command: string, cwd?: string): void => {
  expect(judge(helper, command, cwd)).not.toHaveProperty('refusal');
};
const refused = (helper: Helper, command: string, because: string, cwd?: string): void => {
  expect(refusalIn(helper, command, cwd)).toContain(because);
};
const refusalIn = (helper: Helper, command: string, cwd?: string): string => {
  const verdict = judge(helper, command, cwd);
  if (!('refusal' in verdict)) throw new Error(`allowed, and would run: ${verdict.command}`);
  return verdict.refusal;
};
const runs = (helper: Helper, command: string, cwd?: string): string => {
  const verdict = judge(helper, command, cwd);
  if (!('command' in verdict)) throw new Error(`refused: ${verdict.refusal}`);
  return verdict.command;
};

describe('what bruce-review may run', () => {
  test('its prompt, the history and the gates', () => {
    ok('bruce-review', 'brucelee ticket review BRC-9080 --repo sms --dry-run');
    ok('bruce-review', 'git -C /data/code/work/bruce/sms/server/node diff origin/development...BRC-9080-x --stat');
    ok('bruce-review', 'cd /data/code/work/bruce/app/client/web/code && npx vitest run --silent 2>&1 | tail -30');
    ok('bruce-review', 'cd code && npx tsc --noEmit -p tsconfig.json');
    ok('bruce-review', 'eslint ./src --ext .ts --quiet > /tmp/bruce-review/lint.txt 2>&1');
    ok('bruce-review', 'git branch --show-current');
    ok('bruce-review', 'git -C /data/code/work/bruce/sms/server/node ls-files "*/Feature/List/setup.ts"');
    ok('bruce-review', 'diff /tmp/bruce-review/new.ts src/Feature/List/setup.ts | grep -c "^[<>]"');
    ok('bruce-review', 'brucelee ticket tests BRC-9080');
  });
  test('nothing that writes the tree, the build or the dependencies', () => {
    refused('bruce-review', 'cd /data/code/work/bruce/sms/server/node/code && npm run build', 'npm only as');
    refused('bruce-review', 'npm ci', 'npm only as');
    refused('bruce-review', 'npx eslint ./src --fix', 'without --fix');
    refused('bruce-review', 'npx tsc -p tsconfig.json', '--noEmit');
    refused('bruce-review', 'git checkout development', 'not a read');
    refused('bruce-review', 'git stash', 'not a read');
    refused('bruce-review', 'git branch new-branch', 'only to read');
    refused('bruce-review', 'git -c core.pager=x log', 'configuration');
    refused('bruce-review', 'git diff --output=/data/code/work/bruce/x.patch', '--output');
    refused('bruce-review', 'echo x > /data/code/work/bruce/sms/server/node/code/src/a.ts', 'only /tmp');
    refused('bruce-review', 'sed -i s/a/b/ file.ts', 'not on');
    refused('bruce-review', 'brucelee ticket review BRC-9080 --repo sms', '--dry-run');
    refused('bruce-review', 'brucelee ticket covering --run src/a.ts', 'does not run them');
    refused('bruce-review', 'brucelee ticket mutate BRC-9080 src/a.ts', 'not one of');
    refused('bruce-review', 'npx playwright test', 'only bruce-verify');
  });
});

describe('what bruce-rereview may run', () => {
  test('the change section and the files of a revision', () => {
    ok('bruce-rereview', 'mkdir -p /tmp/bruce-rereview/r1');
    ok('bruce-rereview', 'brucelee ticket review BRC-9103 --repo client --dry-run > /tmp/bruce-rereview/r1/prompt.md');
    ok('bruce-rereview', 'grep -n "^## " /tmp/bruce-rereview/r1/prompt.md');
    ok('bruce-rereview', 'git -C /data/code/work/bruce/app/client/web show BRC-9103-x:code/src/a.ts | grep -n \'\'');
    ok('bruce-rereview', 'git -C /data/code/work/bruce/sms/server/node grep -n limit origin/development -- code/src');
    ok('bruce-rereview', 'git -C /data/code/work/bruce/app/client/web diff origin/development...BRC-9103-x --stat');
    expect(runs('bruce-rereview', 'git -C /data/code/work/bruce/app/client/web show BRC-9103-x:code/src/a.ts')).toContain('show --no-textconv');
  });
  test('no gate, no browser, no other verb', () => {
    refused('bruce-rereview', 'cd /data/code/work/bruce/app/client/web/code && npm run check', 'runs no gate');
    refused('bruce-rereview', 'npx tsc --noEmit', 'runs no gate');
    refused('bruce-rereview', 'vitest run', 'runs no gate');
    refused('bruce-rereview', 'brucelee ticket review BRC-9103 --repo client', '--dry-run');
    refused('bruce-rereview', 'brucelee status', 'not one of');
    refused('bruce-rereview', 'brucelee ticket covering a.ts', 'not one of');
    refused('bruce-rereview', 'git checkout BRC-9103-x', 'not a read');
    refused('bruce-rereview', 'sed -n 1,5p f', 'not on');
    refused('bruce-rereview', 'playwright-cli -s=bruce-verify open http://x', 'only bruce-verify');
  });
});

describe('what bruce-verify may run', () => {
  test('the stack, its own browser, orders and a read-back', () => {
    ok('bruce-verify', 'brucelee dev ready --wait 120');
    ok('bruce-verify', 'PLAYWRIGHT_MCP_SECRETS_FILE="$HOME/.config/secrets/agent-web" playwright-cli -s=bruce-verify open http://localhost:8080/app/slots');
    ok('bruce-verify', 'playwright-cli -s=bruce-verify screenshot --filename=/tmp/bruce-verify/r1/c1.png');
    ok('bruce-verify', `brucelee sms order 6cyd4LE1Dv --as agency --scope slot=abc123 --json`);
    ok('bruce-verify', 'brucelee sms read Slot DQNFW40EiM');
    ok('bruce-verify', 'cd /data/code/work/bruce/e2e && brucelee dev hold -- npx playwright test --grep "\\[A3a\\]"');
    ok('bruce-verify', 'mkdir -p /tmp/bruce-verify/r1');
  });
  test('never the shared browser profile, a database script or a session token', () => {
    refused('bruce-verify', 'playwright-cli -s=code open http://localhost:8080', 'its own session');
    refused('bruce-verify', 'playwright-cli -s=bruce-verify open http://x --persistent --profile=/home/shad/.local/state/agent-web/profiles/code', 'in-memory');
    refused('bruce-verify', 'playwright-cli -s=bruce-verify kill-all', 'reaches past');
    refused('bruce-verify', 'playwright-cli -s=bruce-verify screenshot --filename=/data/code/work/bruce/x.png', 'only under /tmp');
    refused('bruce-verify', 'brucelee sms db < /tmp/script.js', 'cannot read');
    ok('bruce-verify', `brucelee sms read Slot DQNFW40EiM | jq -c 'if . == null then "gone" else [to_entries[] | select(.key | startswith("_p_")) | select(.value != null) | .key] end'`);
    refused('bruce-verify', 'brucelee sms read _Session DQNFW40EiM', 'the collection');
    refused('bruce-verify', 'brucelee sms read Slot DQNFW40Ei', 'the id');
    refused('bruce-verify', 'brucelee sms read Slot DQ"NFW40Ei', 'unclosed double quote');
    refused('bruce-verify', 'brucelee sms read Slot DQNFW40EiM extra', 'nothing else');
    refused('bruce-verify', 'brucelee sms read Slot', 'nothing else');
    refused('bruce-review', 'brucelee sms read Slot DQNFW40EiM', 'not one of');
    refused('bruce-verify', 'brucelee sms session login --as agency', 'not one of');
    refused('bruce-verify', 'brucelee dev hold -- npm run build', 'npm only as');
    refused('bruce-verify', 'brucelee dev stop sms', 'not one of');
  });
});

describe('what bruce-catch-up may run', () => {
  test('the listing and the files it reads', () => {
    ok('bruce-catch-up', 'brucelee ticket new planning');
    ok('bruce-catch-up', 'brucelee transcript google-meet/61fbab3e --at 12:30');
    ok('bruce-catch-up', 'brucelee ticket facts planning notes');
    ok('bruce-catch-up', 'cd ~/.local/state/brucelee/tickets && cat BRC-9080/plan/PLAN.md');
  });
  test('no marking, no linking, no git and no gates', () => {
    refused('bruce-catch-up', 'brucelee ticket mark planning --listed', 'not one of');
    refused('bruce-catch-up', 'brucelee ticket meeting BRC-9080 --link google-meet/61fbab3e', 'meetings.txt');
    refused('bruce-catch-up', 'git log', 'no git');
    refused('bruce-catch-up', 'npx vitest run', 'no gate');
  });
});

describe('every way of running a program the rules do not name', () => {
  test('the seven ways the workflow review probed, and the loop it found', () => {
    refused('bruce-review', 'git grep -Osh foo', 'runs the program it names');
    refused('bruce-review', 'git grep -Ocat foo', 'runs the program it names');
    refused('bruce-review', 'git diff --ext-diff', 'diff.external');
    refused('bruce-review', 'git log --textconv', 'diff.<driver>.textconv');
    refused('bruce-review', 'git cat-file --filters -p HEAD:f.txt', 'smudge filters');
    refused('bruce-review', 'git log --show-signature', 'gpg.program');
    refused('bruce-review', 'git log --format=%G?', 'gpg.program');
    refused('bruce-review', 'git status -v', 'textconv');
    refused('bruce-review', 'git range-diff a b', 'gets none of the flags');
    refused('bruce-review', 'git --exec-path=/tmp log', 'can name any program');
    refused('bruce-review', 'npm run check -- --fix', 'every word after the script name');
    refused('bruce-verify', 'npm run journeys -- --update-snapshots', 'every word after the script name');
    refused('bruce-review', 'rg --pre=sh foo', '--pre');
    refused('bruce-review', 'rg --hostname-bin=sh foo', '--hostname-bin');
    refused('bruce-review', 'rg -z foo x.gz', 'search-zip');
    refused('bruce-verify', "echo 'db.adminCommand({dropDatabase:1})' | brucelee sms db", 'cannot read');
    refused('bruce-verify', `echo 'db.Slot["deleteMany"]({})' | brucelee sms db`, 'cannot read');
  });
  test('substitution, heredocs, background jobs and unknown programs', () => {
    refused('bruce-review', 'git log $(rm -rf /tmp/x)', 'command substitution');
    refused('bruce-review', 'git log "`touch x`"', 'command substitution');
    refused('bruce-verify', "brucelee sms db <<'EOF'", 'heredoc');
    refused('bruce-review', 'git log & rm -rf out', 'background');
    refused('bruce-review', 'git log; rm -rf out', 'not on');
    refused('bruce-review', 'git log && node -e "1"', 'not on');
    refused('bruce-review', 'git log | xargs rm', 'not on');
    refused('bruce-review', 'find . -name "*.ts" -delete', 'find with an action');
    refused('bruce-review', 'cd ../../etc', 'cd only');
    refused('bruce-review', 'cd ~/.ssh', 'cd only');
    refused('bruce-review', 'cd ~root', 'cd only');
    refused('bruce-review', 'NODE_OPTIONS=--require=x npx vitest run', 'variable');
    refused('bruce-review', 'git log', 'working directory', '/data/code/logos');
  });
  test('a quoted operator is a word, not an operator', () => {
    ok('bruce-review', 'git log --format="%h; %s" -5');
    ok('bruce-review', "grep -n 'a && b | c > d' src/x.ts");
  });
});

describe('what the guard adds to a git read, and nothing else', () => {
  const CONFIGS = '-c core.pager=cat -c core.fsmonitor=false -c log.showSignature=false';
  test('the environment, three configs, and the subcommand negations', () => {
    expect(runs('bruce-review', 'git diff --stat')).toBe(
      `GIT_OPTIONAL_LOCKS=0 git ${CONFIGS} diff --no-ext-diff --no-textconv --stat`,
    );
    expect(runs('bruce-review', 'git status --porcelain')).toBe(
      `GIT_OPTIONAL_LOCKS=0 git ${CONFIGS} status --porcelain`,
    );
    expect(runs('bruce-review', 'git log -1')).toContain('log --no-textconv');
    expect(runs('bruce-review', 'git log -1')).not.toContain('--no-ext-diff');
    expect(runs('bruce-review', 'git -C /data/code/work/bruce/sms/server/node diff origin/development...BRC-9080-x --stat')).toBe(
      `GIT_OPTIONAL_LOCKS=0 git ${CONFIGS} -C /data/code/work/bruce/sms/server/node diff --no-ext-diff --no-textconv origin/development...BRC-9080-x --stat`,
    );
  });
  test('a command with nothing to add runs byte for byte', () => {
    expect(runs('bruce-review', 'git branch --show-current')).toBe('git branch --show-current');
    expect(runs('bruce-review', "grep -n 'a && b | c > d' src/x.ts")).toBe("grep -n 'a && b | c > d' src/x.ts");
  });
  test("a helper that copies the guard's own prefix back is let through, and no other value is", () => {
    expect(runs('bruce-rereview', 'GIT_OPTIONAL_LOCKS=0 git log -1')).toContain('log --no-textconv -1');
    refused('bruce-rereview', 'GIT_OPTIONAL_LOCKS=1 git log -1', 'GIT_OPTIONAL_LOCKS');
    refused('bruce-rereview', 'GIT_OPTIONAL_LOCKS=0 GIT_DIR=/x git log -1', 'GIT_DIR');
  });
});

describe('the wiring omp calls', () => {
  type Handler = (event: unknown, ctx: unknown) => Promise<unknown>;
  /** The `tool_call` handler the guard registers, from a `pi` that records what it is given. */
  const wired = (): Handler => {
    let handler: Handler | undefined;
    helperGuard({
      on: (name: string, fn: Handler): void => {
        if (name === 'tool_call') handler = fn;
      },
    } as unknown as ExtensionAPI);
    if (handler === undefined) throw new Error('the guard registered no tool_call handler');
    return handler;
  };
  const call = (toolName: string, input: unknown, agent: unknown): Promise<unknown> =>
    wired()({ type: 'tool_call', toolCallId: 't1', toolName, input }, { agent });
  const review = { kind: 'sub', id: '0-bruce-review', name: 'bruce-review', depth: 1 };

  test('a refused call is blocked, a rewritten one is handed back, the rest is left alone', async () => {
    expect(await call('bash', { command: 'touch /tmp/guard-test' }, review)).toEqual({
      block: true,
      reason: "helper guard: bruce-review may not run this — touch is not on bruce-review's list",
    });
    expect(await call('bash', { command: 'git status --porcelain' }, review)).toEqual({
      input: {
        command:
          'GIT_OPTIONAL_LOCKS=0 git -c core.pager=cat -c core.fsmonitor=false -c log.showSignature=false status --porcelain',
      },
    });
    expect(await call('bash', { command: 'git branch --show-current' }, review)).toBeUndefined();
    expect(await call('write', { path: '/tmp/guard-test', content: 'x' }, review)).toEqual({
      block: true,
      reason: 'helper guard: bruce-review may not call write',
    });
    expect(await call('bash', { command: 'touch /tmp/guard-test' }, { kind: 'main', id: 'Main', name: 'main', depth: 0 })).toBeUndefined();
  });
  test('a bruce-rereview call is guarded by name', async () => {
    const rereview = { kind: 'sub', id: '0-bruce-rereview', name: 'bruce-rereview', depth: 1 };
    expect(await call('bash', { command: 'touch /tmp/guard-test' }, rereview)).toEqual({
      block: true,
      reason: "helper guard: bruce-rereview may not run this — touch is not on bruce-rereview's list",
    });
  });
});
