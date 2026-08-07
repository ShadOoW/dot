# System Hygiene & Maintenance (`dot doctor` / `dot sweep`)

This document tracks how we keep the Arch Linux host lean over years of uptime.
The overarching philosophy: **Only keep what is used. Prove usage with data.**

## Active Mechanisms

### 1. `dot doctor` (Analysis & Dotfiles Integrity)

Currently, `doctor` heavily focuses on dotfiles repo structural integrity (broken symlinks, missing files, `.pacnew` / `.pacsave` drift tracking via the `etc-real/` system).

- **Config Drift:** Warns if `.pacnew` / `.pacsave` exist in `/etc` (especially for early-boot `etc-real/` configs, forcing you to update the `etc-real` copy in the dotfiles repo).
- **Symlink Health:** Finds missing system links, broken caches, and structural issues.

### 2. `dot sweep` (Execution & Cruft Removal - WIP)

While `doctor` fixes your config tree, `sweep` is designed to clean the OS disk.

- **Orphan Detection:** Reaps unused dependencies via `pacman -Qtdq`.
- **Cache Enforcement:** Trims pacman cache using `paccache -rk2` (keeping 2 most recent versions for safe downgrade capability) instead of keeping hundreds of gigs of old `.pkg.tar.zst` files.
- **Distributed Cleanup:** Reads `meta.json` from `packages/*` and executes their defined `cleanSteps` (e.g., `npm cache clean`, `cargo cache cleanup`).

### 3. Usage Auditing (GNU Accounting Utilities)

Relying on shell history misses background services, GUI apps, and scripts. Relying on file access times (`atime`) is broken on modern Btrfs filesystems (`relatime`).

To detect software that was explicitly installed but hasn't been used in months, we use process accounting:

1. Ensure GNU Accounting Utilities are installed: `yay -S acct` (available in AUR).
2. Enable it: `systemctl enable --now acct`.
3. The kernel logs _every command executed_ to `/var/log/pacct`.
4. Over time, we can query `sa -c` and cross-reference with `pacman -Qqe` to find explicitly installed packages with zero executions, confirming they are safe to remove.

### 4. Overlap Detection (Semantic Clustering)

To find duplicate software (e.g., having `feh`, `swayimg`, and `imv` installed simultaneously):

- **GUI Apps:** We parse `/usr/share/applications/*.desktop` looking for overlaps in `Categories=` and `MimeType=`.
- **CLI Apps:** We map `pacman -Qi` keywords into clusters (`image.*viewer`, `terminal.*emulator`).
  This allows us to ask "Which of these 3 image viewers do I actually use?" and uninstall the rest.

## Backlog / Future Ideas to Explore

- [ ] Implement `dot sweep` as a standalone command separate from `dot doctor` for executing disk cleanup.
- [ ] Connect `dot sweep` to the `acct` logs for a unified "Cruft Score" report.
- [ ] Cross-reference `~/.config` folders against currently installed packages to find and flag orphaned user configurations left behind after an uninstallation.
- [ ] Check systemd (`systemd-analyze blame`) to flag enabled services that take > 500ms and check if they belong to unused software.
