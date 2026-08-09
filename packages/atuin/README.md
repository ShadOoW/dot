# atuin

Shell history search. Config in `home/.config/atuin/config.toml`.

## Why cargo on Linux, and not the distro package

`/home` is a shared btrfs subvolume and `~/.cache` a shared xfs mount, so **both distros
open the same `~/.local/share/atuin/history.db`**. atuin migrates that database on
startup, and sqlx refuses to open a database carrying migrations the running binary does
not know about. So the newer distro's atuin silently disables the older one's:

```
$ atuin search --limit 1
Error: migration 20260709214605 was previously applied but is missing in the
       resolved migrations
```

That is what happened on 2026-08-08. Arch upgraded to **18.19.0**, which applied five
migrations at 00:58:25 (`shell`, plus four index migrations from `20260723*`). Void's
repo caps at **18.16.1**, so from the next boot every atuin invocation on Void aborted —
including the zsh hook, so **nothing was recorded for 35 hours** and the last entry in
six months of history was `sudo reboot`. Nothing logged a failure; the only symptom was
history quietly not growing.

Pinning both distros to one cargo build removes the skew by construction — there is only
ever one binary and one schema.

Three properties make this work, and all three are load-bearing:

- **`~/.cargo` is `~/.cache/managed-cargo`, on the shared xfs mount.** One `cargo
install` is visible from both boots; there is no second copy to drift.
- **`~/.cache/managed-cargo/bin` precedes `/usr/bin` on `PATH`** (position 12 vs 16), so
  the cargo build shadows any distro package that is still installed. Removing the distro
  package is tidiness, not a prerequisite.
- **Build on Void, not Arch.** glibc symbol versioning is forward-compatible only:
  Void ships 2.41 and Arch 2.44, so a binary built here runs there, and one built there
  would fail to start here. If this ever needs rebuilding, do it from the Void boot.

```sh
cargo install atuin --version 18.19.0 --locked   # pin; do not float
```

The version is pinned deliberately. `cargo install atuin` unpinned would reintroduce the
same failure the moment one boot upgrades and the other does not — the pin is the whole
point, so bump it in one place and rebuild once.

## Checking it still works

The failure mode is silent, so test the _recording_ path, not just the binary:

```sh
exec zsh -l && ls && atuin search --limit 1     # must print a row, not a migration error
```

`dot usage status` is the passive tripwire: it reads this database directly with SQL and
never runs migrations, so it keeps working even while the atuin CLI is broken. A
`history` row whose `last_seen` stops advancing while `acct` and `proc` keep climbing
means atuin has stopped recording — that is precisely how the 2026-08-08 breakage was
found.
