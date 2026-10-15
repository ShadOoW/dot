import { describe, expect, test } from 'bun:test';

import { judge } from '../hooks/pre/helper-guard.ts';

const ok = (helper: Parameters<typeof judge>[0], command: string, cwd?: string): void => {
  expect(judge(helper, command, cwd)).toBeUndefined();
};
const refused = (helper: Parameters<typeof judge>[0], command: string, because: string, cwd?: string): void => {
  expect(judge(helper, command, cwd)).toContain(because);
};

describe('what bruce-review may run', () => {
  test('its prompt, the history and the gates', () => {
    ok('bruce-review', 'brucelee ticket review BRC-9080 --repo sms --dry-run');
    ok('bruce-review', 'git -C /data/code/work/bruce/sms/server/node diff origin/development...BRC-9080-x --stat');
    ok('bruce-review', 'cd /data/code/work/bruce/app/client/web/code && npx vitest run --silent 2>&1 | tail -30');
    ok('bruce-review', 'cd code && npx tsc --noEmit -p tsconfig.json');
    ok('bruce-review', 'eslint ./src --ext .ts --quiet > /tmp/bruce-review/lint.txt 2>&1');
    ok('bruce-review', 'git branch --show-current');
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
    refused('bruce-review', 'npx playwright test', 'only bruce-verify');
  });
});

describe('what bruce-verify may run', () => {
  test('the stack, its own browser, orders and a read-back', () => {
    ok('bruce-verify', 'brucelee dev ready --wait 120');
    ok('bruce-verify', 'PLAYWRIGHT_MCP_SECRETS_FILE="$HOME/.config/secrets/agent-web" playwright-cli -s=bruce-verify open http://localhost:8080/app/slots');
    ok('bruce-verify', 'playwright-cli -s=bruce-verify screenshot --filename=/tmp/bruce-verify/r1/c1.png');
    ok('bruce-verify', `brucelee sms order 6cyd4LE1Dv --as agency --scope slot=abc123 --json`);
    ok('bruce-verify', `echo 'const s = db.Slot.findOne({ _id: "abc" }); print(JSON.stringify(s && s.parentScopes))' | brucelee sms db`);
    ok('bruce-verify', 'cd /data/code/work/bruce/e2e && brucelee dev hold -- npx playwright test --grep "\\[A3a\\]"');
    ok('bruce-verify', 'mkdir -p /tmp/bruce-verify/r1');
  });
  test('never the shared browser profile, a database write or a session token', () => {
    refused('bruce-verify', 'playwright-cli -s=code open http://localhost:8080', 'its own session');
    refused('bruce-verify', 'playwright-cli -s=bruce-verify open http://x --persistent --profile=/home/shad/.local/state/agent-web/profiles/code', 'in-memory');
    refused('bruce-verify', 'playwright-cli -s=bruce-verify kill-all', 'reaches past');
    refused('bruce-verify', 'playwright-cli -s=bruce-verify screenshot --filename=/data/code/work/bruce/x.png', 'only under /tmp');
    refused('bruce-verify', `echo 'db.Slot.deleteOne({ _id: "abc" })' | brucelee sms db`, 'writes');
    refused('bruce-verify', 'brucelee sms db < /tmp/script.js', 'only as');
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

describe('what no guarded helper can slip past', () => {
  test('substitution, heredocs, background jobs and unknown programs', () => {
    refused('bruce-review', 'git log $(rm -rf /tmp/x)', 'command substitution');
    refused('bruce-review', 'git log "`touch x`"', 'command substitution');
    refused('bruce-verify', "brucelee sms db <<'EOF'", 'heredoc');
    refused('bruce-review', 'git log & rm -rf out', 'background');
    refused('bruce-review', 'git log; rm -rf out', 'not on');
    refused('bruce-review', 'git log && node -e "1"', 'not on');
    refused('bruce-review', 'git log | xargs rm', 'not on');
    refused('bruce-review', 'find . -name "*.ts" -delete', 'find with an action');
    refused('bruce-review', 'rg --pre=sh foo', '--pre');
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
