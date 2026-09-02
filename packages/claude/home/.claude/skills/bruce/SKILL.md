---
name: bruce
description: |
  How work is actually done in the Bruce workspace at /data/code/work/bruce: `brucelee` owns
  the seven repositories, the Jira ticket, the branches, the dev servers, and the coupling
  between the four published doc packages and the apps that consume them. Covers the verbs
  that already exist, the overlay model that keeps a consumer resolving your local checkout,
  and the specific hand-work — building doc packages, patching node_modules, starting servers,
  hunting for the right base version — that is already automated and must not be redone.
  Use before touching anything under /data/code/work/bruce; when a consumer does not see a
  change you made in doc/class, doc/event, doc/order or lib/application; when a typecheck
  fails on a field or type that exists in the local checkout but not in the installed package;
  when starting or restarting the sms or client dev server; when a Parse order, cache table,
  Logic rule or order spec is involved; when you are about to run npm install, npm ci,
  npm link, npm run build or edit node_modules by hand in that workspace; and when you need
  the ticket, its brief, or the branch it belongs to.
---

# The Bruce workspace

`/data/code/work/bruce` is seven git repositories in one directory, and `brucelee` is the tool
that knows about all seven at once. **Run `brucelee --help` before anything else.** Every
verb below already exists; the failure mode this skill exists to prevent is doing one of these
jobs by hand for half a session.

    tickets      sprint next fetch show brief answer
    the board    start review done move
    the workspace  status update switch rebase
    local packages links overlay
    dev servers  dev

## First three commands, always

    cd /data/code/work/bruce
    brucelee status     # which branch every repository is on, and what is dirty
    brucelee links      # what each consumer resolves each doc package to

`links` is the one that saves the most time. It answers "does `sms` see my `doc/order` change"
in one line, and the answer is never obvious from reading the source.

## The doc packages and the overlay

Four repositories publish npm packages the three apps consume:

    doc/class     @bruce.work/bruce-doc-class-typescript
    doc/event     @bruce.work/bruce-doc-event-typescript
    doc/order     @bruce.work/bruce-doc-order-typescript
    lib/application/web  @bruce.work/bruce-lib-application-web

A consumer resolves the **published** version by default. It sees your local change only when
that package is *overlaid*: built, packed with `npm pack`, and extracted over the installed
copy inside the consumer's `node_modules`.

**You never set this up.** It is derived from the branches: a producer repository that is not
on `development` is one you are changing, so every consumer of it resolves your checkout.
Switch that repository back to `development` and the overlay ends. The lifetime is the ticket.

    brucelee overlay --dry-run     # what the branches imply, without doing it
    brucelee overlay               # make node_modules match the branches
    brucelee overlay --watch       # …and keep matching, rebuilding on every source change
    brucelee overlay --published   # force everything back to the declared versions

`brucelee dev sms` and `brucelee dev client` do the sync themselves before they build, and
start the watcher alongside the compiler. **So the normal answer is to run the dev server and
nothing else.**

### What this means you must not do

- **Do not `npm link`, and do not add a `file:` dependency.** Both symlink, and a symlinked
  package resolves its own peer dependencies from its own directory rather than the
  consumer's — two copies of one package are two unrelated types. Measured on one ticket:
  between 6 and 1953 typecheck errors depending on which nested version happened to be there,
  none of them in the file being changed.
- **Do not edit anything under `node_modules` by hand.** That is what `overlay` does, atomically
  and reversibly, and it stamps the copy so `links` can tell you what is there.
- **Do not run `npm run build` in a doc package to make a consumer see a change.** The build is
  necessary and `overlay` runs it every time; running it alone changes nothing a consumer reads.
- **Do not `rm -rf` a doc package's build output.** `doc/` is generated and gitignored, its
  `doc/index.json` is the order model every Parse order spec reads through `adapt()`, and a
  half-built one fails every order test with "has no specification" while the types look fine.

### When a consumer's typecheck fails on a type the local checkout has

That is the overlay being absent or the branch being wrong. In order:

1. `brucelee links` — is the package `local` or `npm`?
2. `brucelee status` — is the producer on the ticket branch?
3. `brucelee overlay` — sync, and read the per-consumer note it prints.

Each overlay row says how far past **that consumer's** declared version your checkout is.
Consumers disagree (one may declare 11.25.5 while another declares 11.26.0), so a producer
branched from its own trunk hands consumers other people's unreleased work, and those errors
appear in orders you have never touched. The fix is to branch the producer from the release
commit its consumers declare — the release commits are subjects, `v11.26.0`, not tags.

## Dev servers

    brucelee dev sms       # env, credentials, VPN, database, overlays, compiler, server
    brucelee dev client
    brucelee dev env       # why it would not start, without starting it
    brucelee dev mongo     # a shell against the database the server uses

`dev` gates on the repository's real `tsc`, and refuses to start a server against a tree that
does not compile. When it refuses, the packages row and the note under the failure tell you
whether the errors are yours or the gap between a local checkout and this repository.

The sms server answers on `http://127.0.0.1:2809` — `/healthz` and Parse at `/1/health`.

## Tickets

    brucelee next          # your sprint tickets, most resumable first
    brucelee start BRC-1234 --repo order --repo sms   # branch, push, move to In Progress
    brucelee brief BRC-1234    # reconcile the ticket against the code
    brucelee answer BRC-1234   # fold a chat decision into the brief (reads stdin)
    brucelee review BRC-1234

A ticket is **one branch name across however many repositories the work turns out to need**;
`start --repo` is repeatable and re-runnable. Producer repositories should be branched from the
version their consumers declare, not from `development`.

## The code itself

`/data/code/work/bruce/AGENTS.md` is the authority on how to write the code — feature/section
boundaries, `bring()`, Setup versus useState, order stages, naming, regions. This skill is only
about the machinery around it.
