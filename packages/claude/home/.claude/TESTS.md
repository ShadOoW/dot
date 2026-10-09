# Tests, builds and memory (machine-wide, all projects)

Every agent on this machine shares one host's RAM with the other agents, the user's
browser and games, and the house's servers. A full test suite or a VM build takes
gigabytes. When several run at once, the host's out-of-memory killer closes the user's
windows to make room, and your own run may be killed too.

- **While working, run only the tests that cover what you changed**: the one test file,
  or the one test by name. `vitest run src/foo.test.ts`, `vitest run -t "name"`,
  `pytest path/test_foo.py::test_bar`, `nix build .#checks.x86_64-linux.<one>`.
- **Run a full suite at most once, at the end**, and only when the project's own gate
  asks for it (before a commit, before a handover). Never run it again to confirm a pass
  you have already seen.
- **Leave parallelism alone.** No `--maxWorkers`, `--workers`, `-j`, `--max-jobs`: the
  machine sets them (`VITEST_MAX_WORKERS`, nix `max-jobs`), and a larger value is what
  gets the session killed.
- **One heavy command at a time.** Do not start a second suite, build or VM while one is
  still running in the background.
