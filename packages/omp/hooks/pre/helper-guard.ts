// The helper guard: a Bruce helper that holds a shell runs only the commands its job needs.
//
// Why: a helper reads and returns, and only the calling session writes (the claude package
// README, "Helpers"). Three Bruce helpers cannot do their job without a shell — `bruce-catch-up`
// runs `brucelee ticket new`, `bruce-review` runs git and the gates, `bruce-verify` runs the
// gates, `playwright-cli` and `brucelee sms order` — and a shell can write. In the Bruce
// workspace that is not hypothetical: sms's `npm run build` begins with `rm -rf out`, the running
// dev server's compiled code; `eslint --fix` and `npm ci` rewrite the developer's uncommitted
// work. omp has no per-agent command restriction (an agent file's frontmatter has none, and
// `bash.patterns` applies to the whole session), but an extension sees every tool call of every
// subagent, with the subagent's name, and may refuse it. So each guarded helper gets an
// allowlist here, and anything not on it is refused with the reason (workflow 05).
//
// Fail-closed: a command this file cannot read for certain — command substitution, a heredoc, a
// redirect outside /tmp, an unknown program — is refused. A refused helper says so in its answer,
// and the fix is a line here, not a wider rule.

import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';

export type Helper = 'bruce-catch-up' | 'bruce-review' | 'bruce-verify';

/** `undefined` when the command may run; otherwise why it may not. */
export type Refusal = string | undefined;

const WORKSPACE = '/data/code/work/bruce';
const HOME = process.env.HOME ?? '/home/shad';
const TICKETS = `${HOME}/.local/state/brucelee/tickets`;

/** The tools a guarded helper may call at all; its own `tools` line is narrower still. */
const TOOLS: ReadonlySet<string> = new Set(['read', 'grep', 'glob', 'find', 'bash', 'yield']);

// ── reading a command line ───────────────────────────────────────────────────

type Token = { readonly word: string } | { readonly op: string };

/**
 * Shell words and operators, quotes honoured. Refuses what it cannot read for certain:
 * command substitution, process substitution, heredocs and backslash-newline.
 */
const tokenize = (line: string): readonly Token[] | string => {
  const out: Token[] = [];
  let word = '';
  let inWord = false;
  let i = 0;
  const flush = (): void => {
    if (inWord) out.push({ word });
    word = '';
    inWord = false;
  };
  while (i < line.length) {
    const c = line[i] as string;
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) return 'an unclosed single quote';
      word += line.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length) {
          word += line[j + 1];
          j += 2;
          continue;
        }
        if (line[j] === '`' || (line[j] === '$' && line[j + 1] === '(')) return 'command substitution';
        word += line[j];
        j += 1;
      }
      if (j >= line.length) return 'an unclosed double quote';
      inWord = true;
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      if (line[i + 1] === '\n' || i + 1 >= line.length) return 'a line continuation';
      word += line[i + 1];
      inWord = true;
      i += 2;
      continue;
    }
    if (c === '`' || (c === '$' && line[i + 1] === '(')) return 'command substitution';
    if ((c === '<' || c === '>') && line[i + 1] === '(') return 'process substitution';
    if (c === ' ' || c === '\t') {
      flush();
      i += 1;
      continue;
    }
    if (c === '\n' || c === ';') {
      flush();
      out.push({ op: ';' });
      i += 1;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '<<') return 'a heredoc';
    if (two === '&&' || two === '||') {
      flush();
      out.push({ op: two });
      i += 2;
      continue;
    }
    if (c === '|' || c === '&') {
      flush();
      out.push({ op: c });
      i += 1;
      continue;
    }
    if (c === '>' || c === '<') {
      // A redirect keeps its file descriptor: `2>`, `>>`, `2>&1`.
      const fd = inWord && /^\d$/u.test(word) ? word : '';
      if (fd !== '') {
        word = '';
        inWord = false;
      } else flush();
      let op = fd + c;
      i += 1;
      if (line[i] === '>') {
        op += '>';
        i += 1;
      }
      if (line[i] === '&') {
        op += '&';
        i += 1;
      }
      out.push({ op });
      continue;
    }
    word += c;
    inWord = true;
    i += 1;
  }
  flush();
  return out;
};

type Segment = { readonly words: readonly string[]; readonly pipedFrom: readonly string[] | undefined };

/** Simple commands, with their redirects checked and removed; a pipe's left side is kept. */
const segments = (tokens: readonly Token[]): readonly Segment[] | string => {
  const out: Segment[] = [];
  let words: string[] = [];
  let pipedFrom: readonly string[] | undefined;
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] as Token;
    if ('word' in t) {
      words.push(t.word);
      continue;
    }
    if (t.op === '&') return 'a background job';
    if (t.op === '|' || t.op === ';' || t.op === '&&' || t.op === '||') {
      if (words.length === 0) return `an empty command before "${t.op}"`;
      out.push({ words, pipedFrom });
      pipedFrom = t.op === '|' ? words : undefined;
      words = [];
      continue;
    }
    // A redirect: `2>&1` and `>&2` need no file; every other one names a file in /tmp or /dev/null.
    if (t.op.endsWith('&')) {
      const next = tokens[i + 1];
      if (next !== undefined && 'word' in next && /^\d$/u.test(next.word)) {
        i += 1;
        continue;
      }
      return `the redirect "${t.op}"`;
    }
    const next = tokens[i + 1];
    if (next === undefined || !('word' in next)) return `a redirect "${t.op}" with no file`;
    if (!tmpOrNull(next.word)) return `a redirect to ${next.word} — only /tmp/… or /dev/null`;
    i += 1;
  }
  if (words.length > 0) out.push({ words, pipedFrom });
  return out;
};

const tmpOrNull = (path: string): boolean =>
  path === '/dev/null' || (path.startsWith('/tmp/') && !path.split('/').includes('..'));

const under = (path: string, root: string): boolean =>
  (path === root || path.startsWith(`${root}/`)) && !path.split('/').includes('..');

// ── what each program may do ─────────────────────────────────────────────────

type Rule = (args: readonly string[], helper: Helper) => Refusal;

const has = (args: readonly string[], ...flags: readonly string[]): boolean =>
  args.some((a) => flags.some((f) => a === f || a.startsWith(`${f}=`)));

/** Read-only text tools every guarded helper may use. */
const reading: Readonly<Record<string, Rule>> = {
  cat: () => undefined,
  head: () => undefined,
  tail: (a) => (has(a, '-f', '--follow', '-F') ? 'tail -f never ends' : undefined),
  wc: () => undefined,
  ls: () => undefined,
  grep: () => undefined,
  rg: (a) => (has(a, '--pre') ? 'rg --pre runs a program' : undefined),
  jq: () => undefined,
  sort: (a) => (has(a, '-o', '--output') ? 'sort -o writes a file' : undefined),
  uniq: (a) => (a.filter((x) => !x.startsWith('-')).length > 1 ? 'uniq with an output file' : undefined),
  cut: () => undefined,
  diff: () => undefined,
  echo: () => undefined,
  printf: () => undefined,
  pwd: () => undefined,
  date: () => undefined,
  sleep: () => undefined,
  true: () => undefined,
  find: (a) =>
    has(a, '-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls')
      ? 'find with an action that runs or writes'
      : undefined,
  cd: (a) => {
    const to = (a[0] ?? '').replace(/^~(?=\/|$)/u, HOME);
    const inside = to.startsWith('/') ? under(to, WORKSPACE) || under(to, '/tmp') || under(to, TICKETS) : to !== '' && !to.startsWith('~') && !to.split('/').includes('..');
    return a.length === 1 && inside ? undefined : 'cd only into the Bruce workspace, the tickets directory or /tmp';
  },
  mkdir: (a) =>
    a.every((x) => x === '-p' || tmpOrNull(x)) ? undefined : 'mkdir only under /tmp',
};

const GIT_READS: ReadonlySet<string> = new Set([
  'diff', 'log', 'show', 'merge-base', 'rev-parse', 'rev-list', 'ls-files', 'grep', 'blame',
  'status', 'range-diff', 'cat-file', 'for-each-ref', 'describe', 'shortlog',
]);

const git: Rule = (args) => {
  let rest = args;
  while (rest[0] === '-C' || rest[0] === '--no-pager' || rest[0]?.startsWith('-c')) {
    if (rest[0] === '-C') {
      if (!under(rest[1] ?? '', WORKSPACE)) return 'git -C only inside the Bruce workspace';
      rest = rest.slice(2);
    } else if (rest[0] === '-c') return 'git -c changes configuration';
    else rest = rest.slice(1);
  }
  const sub = rest[0] ?? '';
  if (sub === 'branch') {
    const flags = rest.slice(1).filter((a) => a.startsWith('-'));
    const reads = ['--show-current', '--list', '--contains'];
    return flags.some((f) => reads.includes(f)) && flags.every((f) => [...reads, '-a', '-r', '-v'].includes(f))
      ? undefined
      : 'git branch only to read (--show-current, --list, --contains)';
  }
  if (!GIT_READS.has(sub)) return `git ${sub} is not a read`;
  if (has(rest, '--output', '-o') && sub !== 'grep') return `git ${sub} --output writes a file`;
  return undefined;
};

/** The gates of `rule://package-verification`, never the ones that write or install. */
const gate = (program: string, args: readonly string[]): Refusal => {
  switch (program) {
    case 'vitest':
      return args[0] === 'run' && !has(args, '-u', '--update', '--watch')
        ? undefined
        : 'vitest only as `vitest run`, never updating snapshots';
    case 'eslint':
      return has(args, '--fix', '--fix-dry-run', '-o', '--output-file', '--cache') ? 'eslint without --fix or an output file' : undefined;
    case 'tsc':
      return args.includes('--noEmit') && !has(args, '--build', '-b', '--watch', '-w')
        ? undefined
        : 'tsc only with --noEmit (sms emits its build into out/, which the dev server runs)';
    case 'playwright':
      return args[0] === 'test' && !has(args, '--update-snapshots', '-u', '--ui') ? undefined : 'playwright only as `playwright test`';
    default:
      return `${program} is not a gate`;
  }
};

const NPM_SCRIPTS: ReadonlySet<string> = new Set(['check', 'journeys']);

const npx: Rule = (args, helper) => {
  const [program = '', ...rest] = args.filter((a) => a !== '--no-install');
  if (program === 'playwright' && helper !== 'bruce-verify') return 'only bruce-verify runs the journeys';
  return gate(program, rest);
};

const npm: Rule = (args, helper) => {
  if (args[0] !== 'run' || !NPM_SCRIPTS.has(args[1] ?? '')) return 'npm only as `npm run check` or `npm run journeys`';
  if (args[1] === 'journeys' && helper !== 'bruce-verify') return 'only bruce-verify runs the journeys';
  return undefined;
};

/** `brucelee` verbs per helper: the first one, two or three words that name the verb. */
const BRUCELEE: Readonly<Record<Helper, readonly string[]>> = {
  'bruce-catch-up': [
    'ticket new', 'ticket facts', 'ticket requirements', 'ticket plans', 'ticket show', 'ticket context',
    'ticket feature', 'ticket meeting', 'transcript', 'meetings',
  ],
  'bruce-review': ['ticket review', 'ticket covering', 'ticket tests', 'status', 'packages links', 'packages overlay'],
  'bruce-verify': [
    'dev ready', 'dev health', 'dev logs', 'dev hold', 'sms order', 'sms db', 'status', 'packages links',
    'ticket covering',
  ],
};

const brucelee = (args: readonly string[], helper: Helper, pipedFrom: readonly string[] | undefined): Refusal => {
  const verb = BRUCELEE[helper].find((v) => {
    const words = v.split(' ');
    return words.every((w, k) => args[k] === w);
  });
  if (verb === undefined) return `brucelee ${args.slice(0, 2).join(' ')} is not one of ${helper}'s verbs`;
  const rest = args.slice(verb.split(' ').length);
  switch (verb) {
    case 'ticket meeting':
      return has(rest, '--link', '--unlink') ? 'ticket meeting --link writes meetings.txt' : undefined;
    case 'ticket review':
      return rest.includes('--dry-run') && has(rest, '--repo') ? undefined : 'ticket review only with --repo and --dry-run';
    case 'packages overlay':
      return rest.includes('--dry-run') ? undefined : 'packages overlay only with --dry-run';
    case 'ticket covering':
      return helper === 'bruce-review' && rest.includes('--run') ? 'bruce-review names the covering tests; it does not run them' : undefined;
    case 'dev hold': {
      const at = rest.indexOf('--');
      if (at < 0) return 'dev hold needs `-- <command>`';
      const inner = rest.slice(at + 1);
      return judgeWords(inner, helper, undefined);
    }
    case 'sms db':
      return dbScript(pipedFrom);
    default:
      return undefined;
  }
};

/** Writes a mongosh script may contain; a read-back reads, it never writes. */
const DB_WRITES =
  /\.(insert|insertOne|insertMany|update|updateOne|updateMany|replaceOne|delete|deleteOne|deleteMany|remove|drop|dropDatabase|bulkWrite|findOneAndUpdate|findOneAndDelete|findOneAndReplace|findAndModify|createCollection|createIndex|renameCollection|aggregate)\b|\$out|\$merge|eval\(|runCommand/u;

const dbScript = (pipedFrom: readonly string[] | undefined): Refusal => {
  if (pipedFrom === undefined || pipedFrom[0] !== 'echo' || pipedFrom.length !== 2) {
    return 'sms db only as `echo \'<script>\' | brucelee sms db`';
  }
  return DB_WRITES.test(pipedFrom[1] as string) ? 'the sms db script writes' : undefined;
};

const playwrightCli: Rule = (args, helper) => {
  if (helper !== 'bruce-verify') return 'only bruce-verify drives a browser';
  if (args[0] !== '-s=bruce-verify') return 'playwright-cli only as `playwright-cli -s=bruce-verify …`, its own session';
  if (has(args, '--persistent', '--profile')) return 'bruce-verify uses an in-memory browser, never a profile';
  const sub = args.find((a, k) => k > 0 && !a.startsWith('-')) ?? '';
  if (['delete-data', 'kill-all', 'install', 'install-browser', 'run-code'].includes(sub)) {
    return `playwright-cli ${sub} reaches past this session's page`;
  }
  for (let k = 0; k < args.length; k += 1) {
    const a = args[k] as string;
    const named = /^--(filename|path|output)(=|$)/u.exec(a);
    if (named === null) continue;
    const file = named[2] === '=' ? a.slice(a.indexOf('=') + 1) : (args[k + 1] ?? '');
    if (!tmpOrNull(file)) return 'playwright-cli writes files only under /tmp';
  }
  return undefined;
};

const ENV_NAMES = /^(PLAYWRIGHT_MCP_SECRETS_FILE|E2E_[A-Z_]+)=/u;

const judgeWords = (words: readonly string[], helper: Helper, pipedFrom: readonly string[] | undefined): Refusal => {
  let rest = words;
  while (rest[0] !== undefined && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(rest[0])) {
    if (!ENV_NAMES.test(rest[0])) return `the variable ${rest[0].split('=')[0] ?? ''}`;
    rest = rest.slice(1);
  }
  const [program = '', ...args] = rest;
  const read = reading[program];
  if (read !== undefined) return read(args, helper);
  switch (program) {
    case 'git':
      return helper === 'bruce-catch-up' ? 'bruce-catch-up reads no git history' : git(args, helper);
    case 'brucelee':
      return brucelee(args, helper, pipedFrom);
    case 'npx':
      return helper === 'bruce-catch-up' ? 'bruce-catch-up runs no gate' : npx(args, helper);
    case 'npm':
      return helper === 'bruce-catch-up' ? 'bruce-catch-up runs no gate' : npm(args, helper);
    case 'vitest':
    case 'eslint':
    case 'tsc':
      return helper === 'bruce-catch-up' ? 'bruce-catch-up runs no gate' : gate(program, args);
    case 'playwright-cli':
      return playwrightCli(args, helper);
    default:
      return `${program} is not on ${helper}'s list`;
  }
};

/** Whether `helper` may run `command` from `cwd`; `undefined` means yes. */
export const judge = (helper: Helper, command: string, cwd?: string): Refusal => {
  if (cwd !== undefined && cwd !== '' && !under(cwd, WORKSPACE) && !under(cwd, '/tmp') && !under(cwd, TICKETS)) {
    return `the working directory ${cwd}`;
  }
  const tokens = tokenize(command);
  if (typeof tokens === 'string') return tokens;
  const parts = segments(tokens);
  if (typeof parts === 'string') return parts;
  if (parts.length === 0) return 'an empty command';
  for (const part of parts) {
    const refusal = judgeWords(part.words, helper, part.pipedFrom);
    if (refusal !== undefined) return refusal;
  }
  return undefined;
};

const HELPERS: ReadonlySet<string> = new Set<Helper>(['bruce-catch-up', 'bruce-review', 'bruce-verify']);

export default function helperGuard(pi: ExtensionAPI): void {
  pi.on('tool_call', async (event, ctx) => {
    const agent = ctx.agent;
    if (agent?.kind !== 'sub' || !HELPERS.has(agent.name)) return undefined;
    const helper = agent.name as Helper;
    if (!TOOLS.has(event.toolName)) return { block: true, reason: `helper guard: ${helper} may not call ${event.toolName}` };
    if (event.toolName !== 'bash') return undefined;
    const input = event.input as { command?: unknown; cwd?: unknown };
    const refusal = judge(helper, String(input.command ?? ''), typeof input.cwd === 'string' ? input.cwd : undefined);
    return refusal === undefined ? undefined : { block: true, reason: `helper guard: ${helper} may not run this — ${refusal}` };
  });
}
