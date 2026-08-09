# System Analysis — `saykuk` (Void Linux)

Full read-only audit, **2026-08-08**. Host `saykuk`, Void Linux, runit, kernel
`6.18.31_1`, i5-13500 + RTX 3060 + UHD 770, 31 GiB RAM, one WD_BLACK SN770 2 TB.
Dual-boots Arch (`@arch` subvol, shared `/boot`, `/home` and `~/.cache`).

Scope: all logs, all 43 supervised services, all package managers, storage, hardware,
kernel and security posture. **Nothing was modified during the audit.** The fixes marked
✅ were applied afterwards and verified; everything else is a recommendation.

---

## Verdict

Hardware is healthy and the memory tier is exactly as designed. The problems are
concentrated in three places:

1. **Nothing is watching.** Alert delivery is broken, `stderr` is discarded for 12 of 30
   services, and 7 core daemons — including `sshd` — log to a syslog socket that does not
   exist. There is no auth audit trail at all.
2. **Nothing protects the data.** 774 GiB of single-profile btrfs has never been
   scrubbed, there are zero snapshots, and SMART is unmonitored on the single NVMe that
   holds everything.
3. **`sshd` is internet-exposed with password auth on.**

Counts: **1 critical, 11 high, 18 medium, 12 low**. Hardware: no MCE, no PCIe AER, no
NVMe errors, no thermal throttling, no `Vulnerable` CPU line, microcode loaded early,
kernel taint is the cleanest a DKMS host can have (`O|E`, no proprietary bit — the NVIDIA
_open_ modules are in use).

---

## CRITICAL

### C1 · `sshd` is on the public internet with password authentication enabled

Four facts compound:

| Fact                | Evidence                                                                              |
| ------------------- | ------------------------------------------------------------------------------------- |
| Password auth is on | `/etc/ssh/sshd_config`: `#PasswordAuthentication yes` (commented ⇒ effective **yes**) |
| No allow-list       | no `AllowUsers`/`AllowGroups` anywhere; `sshd_config.d/` is **empty**                 |
| Listens everywhere  | `ss -tulnp` → `tcp LISTEN 0.0.0.0:22`                                                 |
| Published publicly  | `/data/ops/state/ssh/cloudflared/config.yml` → `ssh.shadhq.com → ssh://localhost:22`  |

`PermitRootLogin` is `prohibit-password` and `MaxAuthTries` is the default 6, so key-only
root is safe — but `shad` is guessable and in `wheel`.

**And failures are invisible**: `/var/log/btmp` is 0 bytes, `/var/log/runit/sshd/` does not
exist, and no syslog daemon runs (see H3). A brute-force attempt against an
internet-facing service would leave no record anywhere on this host.

```sh
# /etc/ssh/sshd_config.d/10-hardening.conf
PasswordAuthentication no
PermitRootLogin no
AllowUsers shad
ListenAddress 127.0.0.1          # cloudflared reaches localhost:22
ListenAddress 100.64.0.1         # tailnet
```

Then confirm a Cloudflare **Access** policy gates `ssh.shadhq.com` — the ingress config
performs no authentication by itself.

---

## HIGH

### H1 · Every triggered alert is silently dropped

Both Gatus and Grafana provision alert rules against a Telegram provider whose secret
file does not exist:

```
/var/log/runit/health/current      (~every 60s, ongoing)
  [watchdog.handleAlertsToTrigger] Not sending alert of type=telegram endpoint
  with key=photoview_photoview-(public) despite being TRIGGERED,
  because the provider wasn't configured properly

/var/log/runit/observability-grafana/current:1
  observability-grafana: no /data/ops/state/health/telegram.env
  — alert rules provisioned, telegram delivery NOT configured
```

`ops-log.jsonl` at 06:25 records making Grafana _tolerate_ the missing secret rather than
exit 1 — correct for availability (it had crash-looped 43 times), but it converted a loud
failure into a silent one. **Every finding in this report had to be discovered by reading
files, because the alerting path terminates in a log line.**

Fix: create `/data/ops/state/health/telegram.env`, or remove the Telegram contact point
from both configs so the dashboards stop claiming alerting exists.

### H2 · `stderr` is discarded for every `/data/ops` service — 12 of 30 log dirs are empty while running

`runsv` wires only **stdout** to the svlogd pipe. No `run` script under
`/data/ops/*/services/` contains `exec 2>&1`, so stderr is inherited from `runsv` and
lost. Go daemons log to stderr by convention, so:

```
0 B: tailscaled, observability-{alloy,loki,prometheus}, hajib-caddy,
     people-cloudflared, adguardhome, navidrome-server, cloudflared-{ssh,health},
     immich-postgres, immich-ml
```

Several are provably alive via their health checks. **This is the Void/runit gap against
the Arch/systemd assumption in `AGENTS.md`**: systemd's journal captures both streams
unconditionally, so the omission is invisible until you switch inits — and it is
currently blocking diagnosis of H5.

Fix: add `exec 2>&1` before the final `exec` in each `run` script.

### H3 · 7 core daemons log to `/dev/log`, which does not exist

```
$ ps -eo args | grep '^vlogger'
vlogger -t dbus …   -t dhcpcd …   -t elogind …   -t iwd …
vlogger -t nix-daemon …   -t sshd …   -t udevd …
$ ls /dev/log                          → No such file or directory
$ ps -eo args | grep -E 'socklog|syslogd|rsyslog'  → (empty)
```

**sshd auth logs, dhcpcd lease events and udevd errors go nowhere.** Combined with C1 and
the 0-byte `btmp`, this host has no authentication audit trail.

Fix: `xbps-install socklog-void && ln -s /etc/sv/socklog-unix /var/service/ && ln -s /etc/sv/nanoklogd /var/service/` — or replace those 7 `log/run` files with
`exec svlogd -tt /var/log/runit/<svc>`, as every `/data/ops` service already does.

### H4 · 774 GiB of single-profile btrfs has never been scrubbed

```
$ ls /var/lib/btrfs/
scrub.status.d7a98795-1604-4baa-ae07-05e29a3ff1e6      # NOT the live pool
$ ls /sys/fs/btrfs/
9cf92fc0-9ff5-4762-a3b7-c70a214e5bae                   # the live pool
$ ls /etc/sv | grep -iE 'scrub|trim|btrfs'   → (none)
$ ls /etc/cron.daily → makewhatis, shadow    # no weekly, no monthly
```

`Data,single` — no parity, no mirror. Silent bitrot in `/data/stash/.ai` (273 GB) would
go undetected until read. Device error counters are all zero
(`/sys/fs/btrfs/…/devinfo/1/error_stats`), which is good but is not a checksum
verification.

Fix: monthly `btrfs scrub start -Bd /` via cron.monthly or a `snooze` service.

### H5 · Zero snapshots exist — no rollback safety net

```
$ ls -la /.snapshots /mnt/pool/@void-snapshots /mnt/pool/@arch-snapshots   → all empty
$ ls /etc/snapper/configs   → No such file or directory
$ which snapper             → not found
```

Both snapshot subvolumes are mounted and provisioned; `packages/snapper-config/` is
ready in this repo (`NUMBER_LIMIT=2`, `TIMELINE_LIMIT_WEEKLY=2`) and `docs/snapper.md`
documents the Void path — but snapper is not among the 827 installed packages. On the
upside there is no snapshot bloat; the risk here is purely the _absence_ of rollback on a
rolling-release box.

Fix: `xbps-install snapper && dot link snapper-config && sudo packages/snapper-config/setup.sh`

### H6 · SMART is unknown and unmonitored on the only disk

`smartctl`/`nvme smart-log` need root; `/etc/sv/smartd` exists but is **not** linked into
`/var/service`. Wear level, media errors, power-on hours and critical warnings are all
unknown for the single WD_BLACK SN770 2 TB (fw `731100WD`) that carries 774 GB btrfs +
225 GB xfs + swap.

Fix: `sudo smartctl -H -A /dev/nvme0n1` now, then `ln -s /etc/sv/smartd /var/service/`.

### H7 · Two service env files are world-readable **and committed to git**

```
-rw-r--r-- 1 shad shad 980 /data/ops/vaultwarden/vaultwarden.env    # password manager
-rw-r--r-- 1 shad shad 519 /data/ops/memos/memos.env
$ cd /data/ops && git ls-files | grep '\.env$'
memos/memos.env
vaultwarden/vaultwarden.env
$ stat -c '%A %n' /data /data/ops → drwxr-xr-x both
```

Mode 0644 under world-traversable directories, so **any local uid can read them** — no
0700 parent saves these, unlike `~/.ssh`. The correctly-restricted files
(`state/immich/immich.env` 0400, `state/people/access.env` 0600) live under the
gitignored `state/`, which is precisely the pattern these two are missing.

Also: `packages/agentmemory/home/.agentmemory/.env` — 4081 bytes, mode 0644, tracked in
_this_ repo. Compare `packages/secrets/`, which correctly ships only a `.example`.
`AGENTS.md`'s "Never commit secrets" convention is being violated in both repos.

Fix: `chmod 600`; move under `state/`; `git rm --cached`; **rotate**; consider
`git filter-repo` if the history is shared.

### H8 · No host firewall, and four services bind every interface while declaring loopback

`iptables`/`ip6tables` service definitions exist in `/etc/sv` but neither is enabled. The
only netfilter state is tailscale's own `ts-*` chains, which do not filter inbound LAN
traffic.

| Service            | Declares                          | Actually binds       | Consequence                                                        |
| ------------------ | --------------------------------- | -------------------- | ------------------------------------------------------------------ |
| `photoview-server` | `PHOTOVIEW_LISTEN_IP=127.0.0.1`   | `*:4040`             | whole photo library LAN-reachable, **bypassing Cloudflare Access** |
| `immich-ml`        | `MACHINE_LEARNING_HOST=127.0.0.1` | `*:3003`             | CLIP/face-detection endpoint open                                  |
| `health` (Gatus)   | README says "SSH port-forward"    | `*:8731`             | full topology + alert config, **no auth**                          |
| `immich-server`    | `IMMICH_PORT=2283`, no host       | `*:2283` + `*:33331` | `:33331` appears in **no** file under `/data/ops`                  |

The first two set an env var their binary ignores. Also LAN-wide: `mpd 0.0.0.0:6600`,
`sshd 0.0.0.0:22`, `adguardhome *:53` (correct by design — it is the LAN resolver).

Fix: pass `--bind 127.0.0.1:3003` to immich-ml's gunicorn explicitly; set
`web: {address: "127.0.0.1"}` in `health/config-base.yaml`; find photoview's real flag
and **re-verify with `ss -tlpn`**; identify `:33331`. Then a default-drop nftables input
chain accepting only `lo`, `tailscale0` and established/related.

### H9 · 28 GB `/nix/store`, never garbage-collected — and the obvious fix is destructive

```
sqlite> SELECT count(*), sum(narSize) FROM ValidPaths;   -- /nix/var/nix/db/db.sqlite
17985 | 14033011264        -- 15904 (88.4%) are .drv files
sqlite> SELECT min(registrationTime) FROM ValidPaths;    -- ~28 days -> no GC ever
$ nix-store --gc --print-roots | wc -l   → 9940
$ ls /nix/var/nix/gcroots/auto | wc -l   → 12
$ ls /data/ops/state/*/env | wc -l       → 15
```

`/etc/nix/nix.conf` is 4 lines and sets no `min-free`/`max-free`, so nothing will ever
reclaim automatically. **The store is load-bearing**: 15 `/data/ops/state/*/env` symlinks
point into it and the ops services exec from `$ENVDIR/bin`. With only 12 auto gcroots
against 15 env symlinks, `[INFERENCE]` at least 3 service closures may be unrooted and
would be destroyed by a naive `nix-collect-garbage -d`.

**Do not GC blind.** First:

```sh
nix-store --gc --print-roots | grep /data/ops/state    # confirm all 15 are rooted
# root any missing:  nix build --out-link /data/ops/state/<p>/env …
nix-collect-garbage -d --dry-run                       # review, then commit
```

Then set `min-free`/`max-free` in `/etc/nix/nix.conf` so this stops being manual.

### H10 · Four service entry points depend on user-writable version-manager paths

The exact hazard `AGENTS.md` documents (agentmemory at ~590 restarts/boot on
`status=203/EXEC`):

| Consumer                                            | Path                                                        |
| --------------------------------------------------- | ----------------------------------------------------------- |
| `packages/agentmemory/…/sv/agentmemory/run:27`      | `FNM_BIN=/home/shad/.cache/managed-fnm/aliases/default/bin` |
| `packages/agentmemory/…/agentmemory.service:8`      | `%h/.cache/managed-fnm/aliases/default/bin/agentmemory`     |
| `/data/ops/lake/services/runit/lake-collect/run:22` | `PATH="$ENVDIR/bin:$HOME/.bun/bin:…"`                       |
| `/data/ops/people/services/runit/web/run:34`        | same                                                        |

Any `fnm alias default` silently re-aims four service entry points. The runit script does
guard with a 30 s backoff, so it degrades slowly rather than hot-looping — but it has **no
`log/` supervisor**, so that warning is never persisted.

Fix: add node to the ops nix closures (as lake/people already do for everything else via
`$ENVDIR/bin`), or make the fnm alias a `dot`-managed symlink validated by `dot doctor`.
Add `/etc/sv/agentmemory/log/run`.

### H11 · `dot sweep` was broken on Void — after emitting a false all-clear ✅ FIXED

`src/commands/sweep.ts` was fully pacman-hardcoded with no `commandExists()` guard:

- It searched for `*.pacnew`, a marker **Void never writes** (Void uses
  `<file>.new-<version>`), so it printed `No config drift found in /etc.` as a confident
  pass regardless of truth.
- It then called `pacman -Qtdq`. `run()` is `Bun.spawn`, which **throws ENOENT** rather
  than returning 127 — verified — taking the rest of the sweep with it.

So the one command whose job is trimming caches and removing orphans **had never run on
the Void boot**, which is exactly why H12 and the `wlroots0.19` orphan existed.

Rewritten data-driven over both package systems. Verified:

```
▸ System Sweeper
  · package system: xbps
  · Checking for unmerged config files (xbps)
  ✓ No unmerged config files in /etc.          ← now clean for the right reason
  · Checking for orphaned packages (xbps)
  ! Found 1 orphaned package(s): wlroots0.19-0.19.3_1
```

---

## MEDIUM

### M1 · No audio server is running at all

Surfaced by `dot usage` while validating it — `pipewire` showed as installed-but-never-observed:

```
$ pgrep -a pipewire wireplumber pulseaudio   → nothing
$ wpctl status                               → Could not connect to PipeWire
$ ls /dev/snd                                → controlC0 controlC1 pcmC0D0p … (cards present)
```

`pipewire`, `wireplumber`, `pulseaudio`, `pavucontrol`, `alsa-utils` are all installed and
manual; `docs/pipewire.md` exists; `mpd`/`ncmpcpp`/`mpv` are configured. Nothing is
running. Note also that `/etc/sv/rtkit` is disabled, so PipeWire could not get RT
priority even once started, and `/etc/sv/alsa` is disabled, so mixer state is not saved
across reboots.

### M2 · Reboot pending — running kernel is 12 stable releases behind

`uname -r` = `6.18.31_1` (built **May 15**) vs installed `linux6.18-6.18.43_1`, whose
initramfs was rebuilt today at 06:59. NVIDIA DKMS is **already built** for 6.18.43_1
(`/var/lib/dkms/nvidia/kernel-6.18.43_1-x86_64`, 2 h old), so the reboot will not lose
the GPU. Verify `nvidia-smi` afterwards.

### M3 · `dot kernel` reclaimed nothing ✅ FIXED

`vkpurge list` already excludes the running kernel and any package-owned one — confirmed
in its source (`list_kernels()` skips `$running` and anything matching
`xbps-query -o /boot/vmlinu[xz]-*`). Applying `KEEP_COUNT = 2` on top double-counted
those exclusions, so with exactly two purgeable kernels it removed **zero** while printing
"nothing to remove" and 473 MB sat idle in `/boot`.

Now `KEEP_PURGEABLE = 1`, leaving three bootable options (running, installed, one older).
Verified:

```
$ dot kernel --check
  · linux — arch, skipped      · linux-zen — arch, skipped
  · 6.18.36_1 — remove         ✓ 6.18.38_1 — keep
```

### M4 · `/var/cache/xbps` is 1.9 GB and has never been trimmed

450 files, oldest `libmad-0.15.1b_10` from **Sep 2023**. Provably superseded, enumerated
exactly: chromium 150 (132 MB), linux6.18-6.18.38 + headers (173 MB), the `mesa-*-26.1.4`
set (40 MB), noto-fonts 2026.07.01 (17 MB), the `libav*6-6.1.6_1` set (9.8 MB), and
others — **382 MB**. Root cause was H11. Fix: `sudo xbps-remove -O` (or `dot sweep`).

### M5 · AdGuard's DNS listener intermittently stalls — 12 timeouts, still recurring

```
/var/log/runit/health/current
07:46:53 [client.QueryDNS] Error exchanging DNS message: read udp
         127.0.0.1:47403->127.0.0.1:53: i/o timeout        (+11 more, last 08:37:53)
```

Not a crash — a **stall**: the web UI check succeeds in 2 ms within seconds of every DNS
failure, so the process is alive and responsive on HTTP while UDP blocks. This is almost
certainly also the cause of M6 (5 s flaps) and the three tunnel restarts in M7.
Diagnosis is blocked by H2 — AdGuard's own log is 0 bytes. **Fix H2 first.**

### M6 · `hajib-caddy` and BentoPDF flapped for 55 min on a 5 s timeout boundary

`hajib-immich`/`hajib-sunshine` alternated fail/succeed with `duration=3.077s`, `5.052s`,
`5.11s` — pinned to the check timeout, not a refusal. Recovered at 08:36–08:37 with
`duration=20ms`, proving the backend was always fine and something upstream stalled ~5 s.
Same root cause as M5. **Resolved, not currently broken.**

### M7 · Three cloudflared tunnels restart 392 s after every boot

`cloudflared-ssh`, `navidrome-cloudflared`, `photoview-cloudflared` all show child
`etimes=10596` against their svlogd's `10988` — one simultaneous restart at boot+392 s.
`[INFERENCE]` a resolver readiness race: `dhcpcd` and `adguardhome` come up at Δboot 0 but
AdGuard needs time to serve. Self-healing, but **every boot has ~6.5 min where three
public hostnames are unreachable.** Fix: add a `/dev/tcp` resolver readiness wait, per the
existing ops convention.

### M8 · Gatus and its tunnel crashed 1 h 45 m into the boot

`health` child `etimes=4625` vs its svlogd `10988`; `cloudflared-health` 4594 vs 10988.
Symlinks date from Jul 6, so these are crash-and-restart under a live `runsv`, not
enables. **The monitor is the thing that fell over**, 31 s before its tunnel.

> Reusable technique: `sv status` is unusable unprivileged
> (`/run/runit/supervise.*` is 0700 root). `svlogd` is started once by `runsv` and never
> restarted, so **`svlogd_etimes ≫ child_etimes` is a precise crash signature.** That is
> what exposed this, `cloudflared-health`, `dhcpcd` (M9) and M7.

### M9 · `dhcpcd` segfaulted twice this boot

```
[6374.742553] dhcpcd[894]:   segfault at 5559e79f6 … error 4   # read of non-present page
[7167.797558] dhcpcd[14265]: segfault at 0 …          error 6   # write to NULL
```

The only two segfaults in the entire ring buffer, two distinct crash sites ~13 min apart.
Not an OOM kill (`dhcpcd` is in earlyoom's `--avoid` list). Network config silently
re-races on each restart, and **because it logs through `vlogger` there is no record of
why** (H3).

### M10 · `bentopdf` is rostered and declared but not supervised

```
$ tail -1 /data/ops/hosts/desktop/roster   → bentopdf
$ cat /data/ops/bentopdf/service.list      → bentopdf-cloudflared  cloudflared  -
$ ls /var/service | grep bentopdf          → (nothing)
$ ss -tlpn | grep 20244                    → (nothing; 20241/2/3/5/6 all present)
```

`pdf.shadhq.com` and `pdf.home.shadhq.com` are **down**. `/data/ops/CLAUDE.md` says
`ops check` fails on roster/service.list drift in both directions; this is a third case it
does not catch — rostered **and** declared **and** not supervised.

### M11 · `photoview` has been dead for 4 weeks

`/var/log/runit/photoview-server/current` (mtime 3 weeks) ends with ~256 lines in one
400 ms burst on **2026-07-12**:

```
failed to connect to `host=127.0.0.1 user=photoview database=photoview`:
  FATAL: could not open shared memory segment "/PostgreSQL.852628592" (SQLSTATE 58P01)
```

`58P01` on a shared-memory segment means the Postgres backend was killed out from under
it — not corruption. Both `photoview-server` and `photoview-postgres` are still in
`/var/service` and have written **zero bytes this boot**, while `health` reports
`photoview_photoview-(public) success=false` and `photoview-tunnel-(direct) success=true`
— the tunnel is up, the app behind it is not.

### M12 · `mpd` runs unsupervised on `0.0.0.0:6600`

```
$ ps -eo pid,ppid,etimes,user,args | grep '[m]pd'  → 10940  1  5942  shad  mpd
$ ls /var/service/mpd → (nothing)   $ ls -d /etc/sv/mpd → exists
```

Parent is PID 1: nothing restarts it, nothing captures its output, and it is
LAN-reachable — while a supervised definition sits unused. Fix: `ln -s /etc/sv/mpd /var/service/` with `bind_to_address "127.0.0.1"`.

### M13 · Unsupervised `iii` sidecar on `0.0.0.0:49134`

```
4831  1  6108  shad  ~/.local/bin/iii --config ~/.cache/managed-fnm/node-versions/
                       v26.4.0/installation/lib/node_modules/@agentmemory/…/iii-config.yaml
127.0.0.1:3111, 127.0.0.1:3112, 0.0.0.0:49134
```

PID-1-parented, config path inside the fnm node-version cache (H10 again), one listener on
all interfaces, no supervision, no logs.

### M14 · zram was torn down and rebuilt while 2.8 GiB of swap was in use

`zramen` (child `etimes=5404`) and `agentmemory` (5398) were both re-executed at
boot+~5589 s, **~2 ms apart**, while both symlinks predate the boot. `zramen`'s `run` is
`zramen make; exec pause` with `finish` = `zramen toss`, so a restart destroys and
recreates the zram swap device. `[INFERENCE]` one external event (an OOM kill or an
`sv restart` sweep) hit both.

### M15 · `earlyoom`'s swap threshold is effectively unreachable

```
earlyoom -r 3600 -M 2621440,1310720 -S 6291456,3145728 --avoid … --prefer …
```

earlyoom acts only when memory **and** swap are both under threshold. `-S 6291456` = 6 GiB
free swap against **23.8 GiB total** (7.8 zram + 16 file), so swap must be ~75% consumed
before the memory condition can fire. `docs/zram.md` documents this exact failure from
2026-07-28 ("68% of swap FREE … nothing killed anything") — and the 16 GiB swapfile added
since makes the ratio _worse_. `[INFERENCE]` the `-S` value predates the swapfile.
Currently benign (2.7 GiB used) and earlyoom has never killed anything.

### M16 · No MAC layer — AppArmor compiled in but not enabled

```
$ cat /sys/kernel/security/lsm  → lockdown,capability,landlock,yama
CONFIG_SECURITY_APPARMOR=y
CONFIG_LSM="landlock,yama,loadpin,safesetid,integrity"     # apparmor absent
```

No `apparmor=1 security=apparmor` on the cmdline either. Worth an explicit decision given
a dozen internet-adjacent services, even if the decision is "accepted".

### M17 · `ruff` is installed twice by two independently-updating managers

`/home/shad/.local/bin/ruff` (uv tool) **and** `/usr/bin/ruff` (xbps, manually installed).
`~/.local/bin` precedes `/usr/bin`, so the uv copy wins and the xbps copy is dead weight
that diverges on every `xbps-install -Su`. The **only** true two-manager duplicate —
`fd`, `rg`, `bat`, `jq`, `uv`, `fzf`, `lsd` are all single-sourced (`/usr/sbin`, `/sbin`,
`/bin` are symlinks to `/usr/bin` on Void, so those repeats are the same inode).

Related manifest/reality mismatches: `packages/yazi` declares `cargo` but yazi is xbps;
`packages/helix` declares `cargo` and helix is installed by neither.

### M18 · Six `dot` packages declare Void dependencies that are not installed

`tmux`, `swayimg`, `helix`, `python3-neovim` (via `packages/nvim`) are declared and
absent; `packages/prettierd` is arch-only (no `void` key — prettier actually comes from
`~/.bun/bin`); `packages/iwmenu` has `"packages": {}` while a 5.9 MB unmanaged binary sits
in `/usr/local/bin`. All six link config for software that is not there.

Root cause: `src/lib/schema.ts:11` — `PACKAGE_MANAGERS = ["brew","xbps","cargo","pacman","yay"]`
cannot express `uv`, `bun`, `nix`, `npm` or `go`, which is why the 7 uv tools and the bun
globals are invisible to `dot`. Fix: extend the enum, then add a `dot doctor` check that
resolves each declaration against `xbps-query`/`command -v`.

---

## LOW

| #   | Finding                                                                                                                                                                                                                | Evidence                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| L1  | Redis warns `vm.overcommit_memory` at every start since 2026-07-09. Real risk: a BGSAVE fork can fail under pressure with 15/31 GiB used                                                                               | `/var/log/runit/immich-redis/current:1,14,27,40` → fix via `/etc/sysctl.d/` |
| L2  | Orphan `initramfs-6.12.87_1.img` (156 MB) in `/boot` with no matching `vmlinuz`, invisible to `vkpurge`; plus 336 MB of stale `/usr/src/kernel-headers-*`                                                              | `ls -la /boot`                                                              |
| L3  | `/tmp` is on-disk btrfs, not tmpfs — 3.1 GB of debris including dbus sockets from **Jun 28** and ~24 scratch dirs                                                                                                      | `du -xh /tmp`                                                               |
| L4  | 29 GB `~/.bun/install/global/node_modules` — the largest single reclaimable item, invisible to every cleaner (`cleanBun` clears `~/.bun/install/cache`, which is **4.0 K**)                                            | `du -sh`                                                                    |
| L5  | `~/.cache` is 46 GB (yay 15 GB incl. firefox-nightly 9.6 GB, managed-bun 6.7 GB, managed-steam 5.7 GB). Shared with Arch via bind mount, so `cleanYay` short-circuits on Void where `yay` is off `PATH`                | `du -sh ~/.cache/*`                                                         |
| L6  | xfs `/mnt/engine` gets no TRIM — btrfs has `discard=async`, xfs has neither `discard` nor any `fstrim` job, on the same SSD                                                                                            | `findmnt -no OPTIONS /mnt/engine`                                           |
| L7  | immich's VERBOSE log level rolled all ten 975 KB svlogd segments **in one second** on 2026-07-10, destroying that service's entire log history                                                                         | 9.8 MB of `@*.s` all one line                                               |
| L8  | Missing `regulatory.db` — kernel falls back to the most restrictive domain, costing 5 GHz channels and TX power                                                                                                        | `xbps-install wireless-regdb`                                               |
| L9  | `xe` loaded with refcount 0 alongside `i915` (refcount 63) — 3.9 MB of kernel memory for a driver that bound nothing, plus latent probe-order risk                                                                     | `/proc/modules`                                                             |
| L10 | 4 Grafana auth failures from `192.168.88.10` (the host's own LAN address — the operator, not an intruder) + 1 `SQLITE_BUSY` in 100 min                                                                                 | `observability-grafana/current:487-515`                                     |
| L11 | Unmanaged binaries with no upgrade path: `/usr/local/bin/iwmenu` 5.9 MB, `~/.local/bin/{iii 31.7 MB, iii-console 12.8 MB, zig 16.6 MB}`, and an entire `papirus-folders` git checkout **with `install.sh` on `$PATH`** | `xbps-query -o` returns nothing                                             |
| L12 | Three stale `/var/log/runit/` dirs with no `/var/service` entry: `navidrome-caddy`, `wireguard`, `bentopdf-cloudflared`. Also `pipx` and `pnpm` installed with zero packages                                           | `ls -1 /var/log/runit`                                                      |

---

## Documentation that is wrong on this boot

`AGENTS.md` and several docs are Arch/systemd-centric in ways that actively mislead here:

| Doc                      | Problem                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/system-hygiene.md` | `pacman -Qtdq`, `paccache`, `yay -S acct`, `systemctl enable --now acct`, `systemd-analyze blame` — **all invalid under Void/runit**                                                                                                                                                                                                                |
| `docs/nvidia.md`         | Prescribes GRUB `nvidia-drm.modeset=1`, `/etc/modprobe.d/nvidia.conf`, and mkinitcpio `MODULES=()`. None exist — `/proc/cmdline` is bare and `/etc/modprobe.d/` is **empty**; this host uses **dracut**. KMS works only because NVIDIA 595 defaults `modeset=1`. Unlike `docs/zram.md` it has no Void section at all                                |
| `docs/zram.md`           | Calls `zswap.enabled=0` "the authoritative switch". True on Arch; on Void `CONFIG_ZSWAP_DEFAULT_ON is not set`, so the missing parameter is benign, not drift. Worth one sentence so nobody "fixes" a non-problem                                                                                                                                   |
| `AGENTS.md`              | The `etc-real/` rule exists because systemd generators run before `/data` is mounted. **Under runit this does not apply to service definitions** — `/etc/runit/core-services/03-filesystems.sh` mounts fstab _before_ stage 2 execs `runsvdir`, proven by all 26 `/data/ops` services showing Δboot = 0. The rule remains correct for the Arch boot |

Conversely, `AGENTS.md`'s interpreter-path hazard is **more** dangerous on Void, not less:
`/etc/runit/2` runs `exec env - PATH=$PATH runsvdir`, scrubbing the environment for every
run script.

---

## Recommended maintenance routine

Verified against this host. `dot sweep` and `dot kernel` now work on Void.

**Immediately (in order)**

1. Harden sshd (C1) and fix the log sinks (H2, H3) — without H3 you cannot see C1 attempts.
2. `chmod 600` + `git rm --cached` + **rotate** the three tracked env files (H7).
3. `sudo smartctl -H -A /dev/nvme0n1`; `ln -s /etc/sv/smartd /var/service/` (H6).
4. Fix alert delivery (H1) — everything else stays invisible until this works.
5. **Reboot** into 6.18.43_1, then `dot kernel` (M2, M3).

**Weekly** — `sudo xbps-install -Syu` (already habitual: installed 2026-04-18, updated
today, `xbps-install -Sun` reports **0 pending**), then `dot usage report`.

**Monthly** — `dot sweep` (orphans + obsolete cache, ~382 MB now, bounded after);
`sudo btrfs scrub start -Bd /` (H4); `sudo fstrim -v /mnt/engine` (L6);
`dot usage unused -d 90`.

**Quarterly** — the guarded nix GC from H9; `uv tool upgrade --all`; `bun upgrade`;
`rustup update`; audit `~/.bun/install/global` (L4).

**After every kernel bump** — reboot, then `dot kernel`.

**Never** — `xbps-pkgdb -a` casually, or any backup that walks `/usr`: it reads every
packaged file and flattens the atime signal `dot usage` depends on. It has already
happened twice (`2026-06-28 22h`, `2026-08-08 05h`).

---

## Checked clean

Verified and healthy — recorded so future audits need not re-derive it.

**Hardware/kernel** · No MCE. No PCIe AER (`_OSC` handed AER to the OS; nothing logged
since). No IOMMU/DMAR faults. No ACPI errors. No NVMe timeouts, resets or I/O errors. No
thermal throttling (`x86_pkg_temp 49 °C`, GPU 41 °C / 13 W at load avg 3.8). **Microcode
loaded early** (`0x2c → 0x3e`). Taint `12288` = `O|E` (out-of-tree + unsigned) from the
NVIDIA _open_ modules only — no `P`, `M`, `D`, `W` or `L`. No kernel WARN/BUG/call trace.
`intel_pstate` active, turbo on, `powersave` governor (correct for HWP).

**CPU vulnerabilities** · **No `Vulnerable` line in any of the 19 files.** 14 `Not
affected`; 5 mitigated: `reg_file_data_sampling`, `spec_store_bypass`, `spectre_v1`,
`spectre_v2` (Enhanced IBRS + BHI_DIS_S), `vmscape`. All `CONFIG_MITIGATION_*` enabled,
KASLR and `STRICT_KERNEL_RWX` on, no `mitigations=off`.

**GPU** · Driver 595.84 / CUDA 13.2; `nvidia`, `nvidia-dkms`, `nvidia-libs`,
`nvidia-firmware` all at 595.84 — no skew. No nouveau conflict. Hybrid split correct:
sway on the Intel iGPU (`i915` refcount 63), RTX 3060 idle and available for offload,
which is why no `WLR_*`/`GBM_BACKEND` overrides are needed.

**Memory tier** · Matches documented intent field-for-field, **zero drift**: zram0 zstd
7.8 GiB (25% of 31) at **pri 100**, 2.7 GiB used compressing 2.4 G → 704 M (~3.5:1);
`/mnt/engine/swapfile` 16 GiB at **pri 10**, **0 B used**. Every value in
`/etc/sv/zramen/conf` is live. earlyoom running under `runsv` with the documented
thresholds and a Void-correct `--avoid` list; **has never killed anything**.

**Storage** · btrfs device error counters **all zero**. No metadata exhaustion and no
balance needed: 475.5 GiB unallocated, metadata DUP 4.66/6.00 GiB, global reserve unused.
Data chunks 97.6% filled (low fragmentation waste — a balance would only burn writes). No
snapshot bloat. No log file over 100 MB anywhere. No core dumps. Trash empty. No
Docker/podman storage. `/boot/efi` 1% used. xfs inodes 2%. fstab coherent, all bind mounts
resolve, `nofail` correctly set on optional mounts.

**Services** · All 43 supervised services up; **0 down, 0 broken symlinks, 0 `down`
files**. No symlink points outside `/etc/sv` or `/data/ops/*/services/runit`. Every
`/data/ops` rundir has a `log/run` (27/27). No `chpst` and no `nc -z` in any ops script
(both banned by `/data/ops/CLAUDE.md`). Only one version-manager path in any run script
(H10) — no `nvm`/`pyenv`/`mise`/`asdf`/`volta` anywhere. All 9 registry ports match
reality. Both Postgres instances and Redis loopback-only. The observability stack is
**entirely** loopback with Alloy the single OTLP door. No init conflicts (`dhcpcd-eth0`,
`wpa_supplicant*` correctly disabled). No `203/EXEC`, no `address already in use`, no TLS
expiry, no database corruption, no exhausted-retry, no `panic:` anywhere in any log.

**Security** · setuid/setgid set is the normal Void set — 24 entries, all accounted for,
nothing stray in `/usr/local/bin` or `/opt`. **No world-writable files in `/etc`.** Sudo
not over-granted: one drop-in, `%wheel ALL=(ALL) ALL`, **no `NOPASSWD`**, confirmed by
`sudo -n -l` requiring a password. All SSH **private keys** correctly 0600. OpenSSH
10.4p1 / OpenSSL 3.6.3. `/data/ops` gitignores `state/`. `/var/log/btmp` is 0 bytes — no
failed login has ever been _recorded_ (see H3 for why that is not reassurance).

**Packages** · **0 updates pending** (`xbps-install -Sun` → empty). Zero held packages,
zero repolocks. Exactly 3 repos, all official `repo-default.voidlinux.org/current`;
`/etc/xbps.d/` empty (no local overrides), no musl, no third-party mirrors. No config
drift (two independent glob strategies over `/etc`). `/opt` fully package-owned. cargo
tidy (3 real binaries + 13 rustup shims). No flatpak, no AppImage, no go globals, no npm
global prefix. `dot doctor`, `dot cache`, `dot update` and `dot kernel` are all correctly
distro-guarded — only `sweep.ts` was not (H11).

---

## Method notes

- Five parallel read-only scouts (logs, services, packages, storage, hardware+security).
  No passwordless sudo, so root-only probes were **skipped and flagged**, never forced:
  `nft list ruleset`, `/etc/sudoers`, `lastb`, `smartctl`, `/var/log/dmesg.log`.
- svlogd stamps **UTC** (`-tt`) while the host is `+01:00`, and application timestamps
  inside log lines are local. **Add 1 h to every `/var/log/runit/*` stamp** before
  correlating with `ps`/`uptime`. Boot was derived from `/proc/stat btime` = 1786168001
  rather than trusting either.
- Unprivileged substitutes that worked: `/sys/fs/btrfs/<uuid>/{allocation,devinfo}` for
  root-only `btrfs` tooling; `/mnt/pool` (subvolid=5) for `btrfs subvolume list`; the
  `svlogd_etimes ≫ child_etimes` crash signature for `sv status`.
- `du`/`stat` only — no full-tree read of `/usr`, no `xbps-pkgdb -a`, so the audit did not
  disturb the atime signal it was also measuring.

See also `docs/usage-tracking.md` for the `dot usage` tracker built alongside this audit,
which is what surfaced M1.
