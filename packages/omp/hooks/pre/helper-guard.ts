// The helper guard: a Bruce helper that holds a shell runs only the commands its job needs.
//
// Why: a helper reads and returns, and only the calling session writes (the claude package
// README, "Helpers"). Four Bruce helpers cannot do their job without a shell — `bruce-catch-up`
// runs `brucelee ticket new`, `bruce-review` runs git and the gates, `bruce-rereview` runs git reads
// and the review prompt's `--dry-run`, never a gate, `bruce-verify` runs the
// gates, `playwright-cli`, `brucelee sms order` and the read-back `brucelee sms read` — and a shell
// can write. In the Bruce workspace that is not hypothetical: sms's `npm run build` begins with
// `rm -rf out`, the running dev server's compiled code; `eslint --fix` and `npm ci` rewrite the
// developer's uncommitted work. omp has no per-agent command restriction (an agent file's
// frontmatter has none, and `bash.patterns` applies to the whole session), but an extension sees
// every tool call of every subagent, with the subagent's name, and may refuse it. So each guarded
// helper gets an allowlist here, and anything not on it is refused with the reason (workflow 05).
//
// WHAT THIS PROMISES. The plausible accident is impossible: a helper cannot write the tree, the
// build, the dependencies or the database, and a git read cannot hand a program of the
// developer's own configuration the file names the command matched. The rules are argv rules:
// they read the words a command names a program with, and for git they add the flags that turn
// the configuration's programs off. Every way of running a program this file refuses is here with
// a test.
//
// WHAT IT ADDS. For every allowed git read: `GIT_OPTIONAL_LOCKS=0` before the program, `-c
// core.pager=cat -c core.fsmonitor=false -c log.showSignature=false` after it, and
// `--no-ext-diff --no-textconv` (diff) or `--no-textconv` (log, show, blame, grep) after the
// subcommand. A rewrite is an insertion and nothing else — every other command runs byte for byte
// as written — except that a git read already beginning `GIT_OPTIONAL_LOCKS=0`, which a helper
// copies back from what it saw run, is let through and carries the word twice, which git accepts.
// Omp revalidates a rewritten command against the tool schema and displays it
// before it runs, so the operator sees what actually ran (`ToolCallEventResult.input`,
// shared-events.d.ts).
//
// WHAT IT DOES NOT BOUND, and cannot from here:
//   - a repository's own configuration still names programs these rules never see
//     (`filter.<driver>.clean`, `core.fsmonitor`, `diff.<driver>.command` reached by a command
//     whose flags are not the ones refused below), and a clone of the developer's tree is where a
//     repository decides that;
//   - a later git or ripgrep that adds another program channel is unbounded until a rule names it;
//     the channels refused below are the ones measured on git 2.54.0 and ripgrep 15.1.0;
//   - npm's argv channel before the script name: `npm run <script>` is bounded, the script itself
//     is the developer's own code;
//   - the credential `brucelee sms read` connects with can write: the verb runs one `findOne` and
//     nothing else, and a read-only database user is still the operator's to create;
//   - three ways the guard is not reached at all: the operator's own session (no `ctx.agent`, or
//     `kind !== "sub"`, by design), a shell-holding agent whose name is not in `HELPERS` (which is
//     why a new shell helper's list goes here before its agent file is linked), and a hook omp
//     failed to load — logged (`logger.error("Failed to load extension", …)`, sdk.ts) and absent
//     from the transcript, so the checks are `bun test packages/omp/test` and `dot pkg omp status`.
// A pattern allowlist of this shape is not a containment boundary, and the vendors of every
// allowlist it resembles say so: Claude Code's docs ("isn't a security boundary around the
// program"), omp's own bundled docs ("Pattern approval is not containment"), Codex (its `.rules`
// only decide what may run outside the sandbox), Trail of Bits ("allowlists of safe commands
// without a sandbox is fundamentally flawed", with the `rg --pre` and `git show --output` RCEs),
// and the eight bypasses of CVE-2025-66032. A boundary is an OS sandbox — `bwrap --ro-bind / / …
// -- bash -c <cmd>` on Linux, which is what Codex does, Seatbelt on macOS — plus a read-only
// database credential; neither is this file's. What it does bound is what a helper may ask the
// database: `brucelee sms read` below, whose two words reach a script this file's rules can read.
//
// Fail-closed: a command this file cannot read for certain — command substitution, a heredoc, a
// redirect outside /tmp, an unknown program — is refused. A refused helper says so in its answer,
// and the fix is a line here, not a wider rule. So is a bug in this file: the hook is bound to the
// extension runner, whose `#runHandlerWithTimeout` catches a throw and returns `onFailure("error",
// …)`, and a 30 s timeout does the same, both becoming `{ block: true }` on a `tool_call`
// (extensions/runner.ts, "an unresponsive extension MUST NOT be treated as silent consent").

import type { ExtensionAPI } from '@oh-my-pi/pi-coding-agent';

export type Helper = 'bruce-catch-up' | 'bruce-review' | 'bruce-rereview' | 'bruce-verify';

/** Why a command may not run. */
export type Refusal = string;

/** Where a rule wants words added to the command the model wrote, and what to add. */
export type Insertion = { readonly at: number; readonly text: string };

/** What `judge` answers: the command that will run, or why none will. */
export type Guarded = { readonly command: string } | { readonly refusal: string };

const WORKSPACE = '/data/code/work/bruce';
const HOME = process.env.HOME ?? '/home/shad';
const TICKETS = `${HOME}/.local/state/brucelee/tickets`;

/** The tools a guarded helper may call at all; its own `tools` line is narrower still. */
const TOOLS: Readonly<Record<string, true>> = { read: true, grep: true, glob: true, find: true, bash: true, yield: true };

// ── reading a command line ───────────────────────────────────────────────────

/** Where a word sits in the line the model wrote; an insertion is spliced in at one of these. */
type Span = { readonly start: number; readonly end: number };

/** A word, with the source it was read from, so a rule can add words around it. */
type Word = Span & { readonly text: string };

type Token = Word | { readonly op: string };

/**
 * Shell words and operators, quotes honoured, each word carrying the span it was read from.
 * Refuses what it cannot read for certain: command substitution, process substitution, heredocs
 * and backslash-newline.
 */
const tokenize = (line: string): readonly Token[] | string => {
  const out: Token[] = [];
  let word = '';
  let start = 0;
  let inWord = false;
  /** Ends the word being read at `at`, which is where its source stops. */
  const flush = (at: number): void => {
    if (inWord) out.push({ text: word, start, end: at });
    word = '';
    inWord = false;
  };
  /** Opens a word at `at`, unless one is already open — `a"b"c` is one word. */
  const begin = (at: number): void => {
    if (!inWord) {
      inWord = true;
      start = at;
    }
  };
  let i = 0;
  while (i < line.length) {
    const c = line[i] as string;
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) return 'an unclosed single quote';
      begin(i);
      word += line.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '"') {
      begin(i);
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
      i = j + 1;
      continue;
    }
    if (c === '\\') {
      if (line[i + 1] === '\n' || i + 1 >= line.length) return 'a line continuation';
      begin(i);
      word += line[i + 1];
      i += 2;
      continue;
    }
    if (c === '`' || (c === '$' && line[i + 1] === '(')) return 'command substitution';
    if ((c === '<' || c === '>') && line[i + 1] === '(') return 'process substitution';
    if (c === ' ' || c === '\t') {
      flush(i);
      i += 1;
      continue;
    }
    if (c === '\n' || c === ';') {
      flush(i);
      out.push({ op: ';' });
      i += 1;
      continue;
    }
    const two = line.slice(i, i + 2);
    if (two === '<<') return 'a heredoc';
    if (two === '&&' || two === '||') {
      flush(i);
      out.push({ op: two });
      i += 2;
      continue;
    }
    if (c === '|' || c === '&') {
      flush(i);
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
      } else flush(i);
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
    begin(i);
    word += c;
    i += 1;
  }
  flush(line.length);
  return out;
};

/** One simple command: its words, in the order the model wrote them. */
type Segment = { readonly words: readonly Word[] };

/** Simple commands, with their redirects checked and removed. */
const segments = (tokens: readonly Token[]): readonly Segment[] | string => {
  const out: Segment[] = [];
  let words: Word[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i] as Token;
    if ('text' in t) {
      words.push(t);
      continue;
    }
    if (t.op === '&') return 'a background job';
    if (t.op === '|' || t.op === ';' || t.op === '&&' || t.op === '||') {
      if (words.length === 0) return `an empty command before "${t.op}"`;
      out.push({ words });
      words = [];
      continue;
    }
    // A redirect: `2>&1` and `>&2` need no file; every other one names a file in /tmp or /dev/null.
    if (t.op.endsWith('&')) {
      const next = tokens[i + 1];
      if (next !== undefined && 'text' in next && /^\d$/u.test(next.text)) {
        i += 1;
        continue;
      }
      return `the redirect "${t.op}"`;
    }
    const next = tokens[i + 1];
    if (next === undefined || !('text' in next)) return `a redirect "${t.op}" with no file`;
    if (!tmpOrNull(next.text)) return `a redirect to ${next.text} — only /tmp/… or /dev/null`;
    i += 1;
  }
  if (words.length > 0) out.push({ words });
  return out;
};

const tmpOrNull = (path: string): boolean =>
  path === '/dev/null' || (path.startsWith('/tmp/') && !path.split('/').includes('..'));

const under = (path: string, root: string): boolean =>
  (path === root || path.startsWith(`${root}/`)) && !path.split('/').includes('..');

// ── what each program may do ─────────────────────────────────────────────────

/**
 * What a rule answers: why the command may not run, the words it wants added to it, or nothing.
 * `spans` holds where each word of `args` sits in the line, for the rules that insert.
 */
type Ruling = Refusal | readonly Insertion[] | undefined;
type Rule = (args: readonly string[], helper: Helper, spans: readonly Span[]) => Ruling;

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
  rg: (a) => {
    if (has(a, '--pre', '--pre-glob')) return 'rg --pre runs a program of its own over every file';
    if (has(a, '--hostname-bin')) return 'rg --hostname-bin runs the program it names';
    if (a.some((w) => w === '--search-zip' || (w.startsWith('-') && !w.startsWith('--') && w.slice(1).includes('z')))) {
      return 'rg -z/--search-zip shells out to the decompressor it picks';
    }
    return undefined;
  },
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

const GIT_READS: Readonly<Record<string, true>> = {
  diff: true, log: true, show: true, 'merge-base': true, 'rev-parse': true, 'rev-list': true,
  'ls-files': true, grep: true, blame: true, status: true, 'range-diff': true, 'cat-file': true,
  'for-each-ref': true, describe: true, shortlog: true,
};

/** The reads that generate a patch, and so run a textconv filter unless it is turned off. */
const NO_TEXTCONV: Readonly<Record<string, true>> = { log: true, show: true, blame: true, grep: true };

/** The flags that make a git read hand files to a program the developer's configuration names. */
const gitSpawn = (sub: string, rest: readonly string[]): Refusal => {
  const pager = rest.find((a) => a === '-O' || a.startsWith('-O') || a.startsWith('--open-files-in-pager'));
  if (pager !== undefined) return `git ${pager} runs the program it names, through a shell if it holds metacharacters`;
  if (has(rest, '--ext-diff')) return 'git --ext-diff runs diff.external or diff.<driver>.command';
  if (has(rest, '--textconv')) return 'git --textconv runs diff.<driver>.textconv';
  if (has(rest, '--filters')) return 'git --filters runs the smudge filters and end-of-line conversion';
  if (has(rest, '--show-signature') || rest.some((a) => a.includes('%G') || a.includes('%(signature'))) {
    return 'git --show-signature and a %G format run gpg.program';
  }
  if (has(rest, '--exec-path', '--config-env')) return 'git --exec-path or --config-env names any program the configuration may run';
  if (sub !== 'grep' && has(rest, '--output', '-o')) return `git ${sub} --output writes a file`;
  return undefined;
};

/** The words the guard adds to a git read: the environment, three configs, and the negations. */
const gitInjections = (sub: string, spans: readonly Span[], after: number): readonly Insertion[] => {
  const program = spans[0];
  // `spans` holds every word of the segment, program included; `after` counts the words of `args`.
  const command = spans[after + 1];
  if (program === undefined || command === undefined) return [];
  const insertions: Insertion[] = [
    { at: program.start, text: 'GIT_OPTIONAL_LOCKS=0 ' },
    { at: program.end, text: ' -c core.pager=cat -c core.fsmonitor=false -c log.showSignature=false' },
  ];
  if (sub === 'diff') insertions.push({ at: command.end, text: ' --no-ext-diff --no-textconv' });
  else if (Object.hasOwn(NO_TEXTCONV, sub)) insertions.push({ at: command.end, text: ' --no-textconv' });
  return insertions;
};

const git: Rule = (args, _helper, spans) => {
  let rest = args;
  let skip = 0;
  for (;;) {
    const head = rest[0];
    if (head === '-C') {
      if (!under(rest[1] ?? '', WORKSPACE)) return 'git -C only inside the Bruce workspace';
      rest = rest.slice(2);
      skip += 2;
      continue;
    }
    if (head === '--no-pager') {
      rest = rest.slice(1);
      skip += 1;
      continue;
    }
    if (head !== undefined && head.startsWith('-c')) return 'git -c changes configuration';
    if (head !== undefined && (head.startsWith('--config-env') || head.startsWith('--exec-path'))) {
      return `git ${head.split('=')[0] ?? head} changes configuration, which can name any program`;
    }
    break;
  }
  const sub = rest[0] ?? '';
  if (sub === 'branch') {
    const flags = rest.slice(1).filter((a) => a.startsWith('-'));
    const reads = ['--show-current', '--list', '--contains'];
    return flags.some((f) => reads.includes(f)) && flags.every((f) => [...reads, '-a', '-r', '-v'].includes(f))
      ? undefined
      : 'git branch only to read (--show-current, --list, --contains)';
  }
  if (!Object.hasOwn(GIT_READS, sub)) return `git ${sub} is not a read`;
  if (sub === 'range-diff') return "git range-diff's inner `git log -p` gets none of the flags this guard adds";
  if (sub === 'status' && rest.some((a) => a === '--verbose' || /^-v+$/u.test(a))) {
    return 'git status -v runs textconv, and status accepts no --no-textconv to turn it off';
  }
  const spawn = gitSpawn(sub, rest);
  if (spawn !== undefined) return spawn;
  return gitInjections(sub, spans, skip);
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

const NPM_SCRIPTS: Readonly<Record<string, true>> = { check: true, journeys: true };

const npx: Rule = (args, helper) => {
  const [program = '', ...rest] = args.filter((a) => a !== '--no-install');
  if (program === 'playwright' && helper !== 'bruce-verify') return 'only bruce-verify runs the journeys';
  return gate(program, rest);
};

const npm: Rule = (args, helper) => {
  if (args[0] !== 'run' || !Object.hasOwn(NPM_SCRIPTS, args[1] ?? '')) return 'npm only as `npm run check` or `npm run journeys`';
  if (args.length > 2) return 'npm passes every word after the script name into its command line';
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
  'bruce-rereview': ['ticket review'],
  'bruce-verify': [
    'dev ready', 'dev health', 'dev logs', 'dev hold', 'sms order', 'sms read', 'status', 'packages links',
    'ticket covering',
  ],
};

/**
 * `brucelee sms read`'s two words: a Parse class name and a ten-character record id.
 *
 * The same two shapes logos holds (`apps/brucelee/lib/dev.ts`'s `CLASS_NAME` and `OBJECT_ID`), and a
 * deliberate second copy — this file cannot import that repository. Neither copy is what makes the
 * read safe (logos hands the words to its own script as values); they are here so a word of the
 * wrong shape is refused where it was typed, with the reason.
 */
const SMS_READ_WORDS = [/^[A-Z][A-Za-z0-9_]{0,39}$/u, /^[A-Za-z0-9]{10}$/u] as const;

/** Whether `sms read` was given exactly a collection and a record id, both of the shapes the verb takes. */
const smsRead = (rest: readonly string[]): Ruling => {
  if (rest.length !== 2) return 'sms read takes a collection and a record id, and nothing else';
  const wrong = rest.findIndex((word, at) => !(SMS_READ_WORDS[at] as RegExp).test(word));
  return wrong < 0 ? undefined : `the ${wrong === 0 ? 'collection' : 'id'} ${JSON.stringify(rest[wrong] ?? '')}`;
};

/** `brucelee`'s own words, `brucelee` included at index 0, so `dev hold -- <command>` keeps its spans. */
const brucelee = (words: readonly Word[], helper: Helper): Ruling => {
  const args = words.slice(1).map((w) => w.text);
  if (args[0] === 'sms' && args[1] === 'db') {
    return 'brucelee sms db runs a script this file cannot read; read one record back with `brucelee sms read <collection> <id>`';
  }
  const verb = BRUCELEE[helper].find((v) => {
    const named = v.split(' ');
    return named.every((w, k) => args[k] === w);
  });
  if (verb === undefined) return `brucelee ${args.slice(0, 2).join(' ')} is not one of ${helper}'s verbs`;
  const width = verb.split(' ').length;
  const rest = args.slice(width);
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
      return judgeWords(words.slice(1 + width + at + 1), helper);
    }
    case 'sms read':
      return smsRead(rest);
    default:
      return undefined;
  }
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

// GIT_OPTIONAL_LOCKS=0 is the word the guard writes before a git read; a helper that copies it back is let through.
const ENV_NAMES = /^(PLAYWRIGHT_MCP_SECRETS_FILE=|E2E_[A-Z_]+=|GIT_OPTIONAL_LOCKS=0$)/u;

/** The helpers that read a repository and never run a gate. */
const runsNoGate = (helper: Helper): boolean => helper === 'bruce-catch-up' || helper === 'bruce-rereview';

const judgeWords = (words: readonly Word[], helper: Helper): Ruling => {
  let skip = 0;
  for (;;) {
    const head = words[skip];
    if (head === undefined || !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(head.text)) break;
    if (!ENV_NAMES.test(head.text)) return `the variable ${head.text.split('=')[0] ?? ''}`;
    skip += 1;
  }
  const passed = words.slice(skip);
  const args = passed.map((w) => w.text);
  const [program = '', ...rest] = args;
  if (program === 'brucelee') return brucelee(passed, helper);
  if (Object.hasOwn(reading, program)) return (reading[program] as Rule)(rest, helper, passed);
  switch (program) {
    case 'git':
      return helper === 'bruce-catch-up' ? 'bruce-catch-up reads no git history' : git(rest, helper, passed);
    case 'npx':
      return runsNoGate(helper) ? `${helper} runs no gate` : npx(rest, helper, passed);
    case 'npm':
      return runsNoGate(helper) ? `${helper} runs no gate` : npm(rest, helper, passed);
    case 'vitest':
    case 'eslint':
    case 'tsc':
      return runsNoGate(helper) ? `${helper} runs no gate` : gate(program, rest);
    case 'playwright-cli':
      return playwrightCli(rest, helper, passed);
    default:
      return `${program} is not on ${helper}'s list`;
  }
};

/** Whether `helper` may run `command` from `cwd`: the command that will run, or a refusal. */
export const judge = (helper: Helper, command: string, cwd?: string): Guarded => {
  if (cwd !== undefined && cwd !== '' && !under(cwd, WORKSPACE) && !under(cwd, '/tmp') && !under(cwd, TICKETS)) {
    return { refusal: `the working directory ${cwd}` };
  }
  const tokens = tokenize(command);
  if (typeof tokens === 'string') return { refusal: tokens };
  const parts = segments(tokens);
  if (typeof parts === 'string') return { refusal: parts };
  if (parts.length === 0) return { refusal: 'an empty command' };
  const insertions: Insertion[] = [];
  for (const part of parts) {
    const ruling = judgeWords(part.words, helper);
    if (typeof ruling === 'string') return { refusal: ruling };
    if (ruling !== undefined) insertions.push(...ruling);
  }
  if (insertions.length === 0) return { command };
  // Right to left, so every offset still names the place in the line it was read from.
  let out = command;
  for (const { at, text } of [...insertions].sort((a, b) => b.at - a.at)) {
    out = out.slice(0, at) + text + out.slice(at);
  }
  return { command: out };
};

const HELPERS: Readonly<Record<string, true>> = {
  'bruce-catch-up': true,
  'bruce-review': true,
  'bruce-rereview': true,
  'bruce-verify': true,
};

export default function helperGuard(pi: ExtensionAPI): void {
  pi.on('tool_call', async (event, ctx) => {
    const agent = ctx.agent;
    if (agent?.kind !== 'sub' || !Object.hasOwn(HELPERS, agent.name)) return undefined;
    const helper = agent.name as Helper;
    if (!Object.hasOwn(TOOLS, event.toolName)) return { block: true, reason: `helper guard: ${helper} may not call ${event.toolName}` };
    if (event.toolName !== 'bash') return undefined;
    const input = event.input as Record<string, unknown>;
    const written = String(input.command ?? '');
    const verdict = judge(helper, written, typeof input.cwd === 'string' ? input.cwd : undefined);
    if ('refusal' in verdict) return { block: true, reason: `helper guard: ${helper} may not run this — ${verdict.refusal}` };
    return verdict.command === written ? undefined : { input: { ...input, command: verdict.command } };
  });
}
