# browsers — Chromium/Vivaldi/Electron launch flags

Three flag files, each read by a different launcher. **None of them supports comments.**

| File                  | Read by                                             | Comments allowed?                 |
| --------------------- | --------------------------------------------------- | --------------------------------- |
| `vivaldi-stable.conf` | `/usr/bin/vivaldi` → `/opt/vivaldi/vivaldi` (shell) | **no** — plain `cat`, see below   |
| `chromium-flags.conf` | nothing — `/usr/bin/chromium` never reads it        | n/a — keep it comment-free anyway |
| `electron.flags.conf` | electron apps                                       | unverified — keep it comment-free |

Every flag file in this package is flags-only, one per line. Reasoning that would otherwise
be a comment goes here instead.

## The main window wedges while its PWAs keep working (2026-09-13, attempt 5)

Symptom: the Vivaldi window on sway workspace 2 stops responding — no clicks, no
shortcuts, stale pixels — while the PWA windows on workspace 10 stay perfectly usable.

Four fixes were aimed at this before and none of them touched the cause, because all four
assumed the window stops _receiving input_:

| when       | change                                           | where                  |
| ---------- | ------------------------------------------------ | ---------------------- |
| 2026-08-05 | `focus_on_window_activation smart` → `focus`     | `sway/styling`         |
| 2026-09-05 | `assign` → `move container to workspace`         | `sway/rules`           |
| 2026-09-05 | wrapper stops nesting a second compositor        | `sway/.local/bin/sway` |
| 2026-08-01 | dropped `--use-gl=egl`, restored GPU compositing | `vivaldi-stable.conf`  |

**A window whose input is dropped and a window whose pixels are frozen look identical.**
Nobody had measured which one it was. `vivaldi-freeze-probe` (in this package) does, by
right-clicking the window — a context menu is a child surface, so grim sees it and
`swaymsg -t get_tree` never can — and by running the same test against a PWA as a control.

Measured during an 11-hour wedge on 2026-09-13, with the window focused and visible:

```
main window   context menu: NO    captures byte-identical, delta 0.000000
pwa control   context menu: yes   delta 0.1056
browser UI thread                 alive, ~7% CPU, polling normally
```

So the client's Wayland event loop is fine — it is serving the PWA toplevels on the same
connection — and only this one toplevel is dead. Everything the compositor can do was
tried, in this order, and **none** of it revived the window:

1. focus bounce to a PWA and back (delivers keyboard leave/enter — kills any stuck grab)
2. `floating enable`/`disable` (a real size change, container went 1904→1908 px wide)
3. `move scratchpad` + `scratchpad show` — a genuine unmap and remap of the toplevel

Killing the GPU process (`--type=gpu-process`) revived it instantly, tabs intact. It
wedged again minutes later. That localises the fault to Chromium's per-window compositing
state — the buffer/frame cycle between its GPU process and the compositor — and rules out
sway focus, workspace placement, and the popup-grab theory the earlier fixes were built on.

The stack under this wedge is newer than every one of those four fixes, which is why they
cannot be the answer even in principle. From `/var/log/pacman.log`:

```
2026-09-09  mesa 26.1.6 -> 26.2.2, linux-zen 7.1.6 -> 7.2.4, vivaldi 8.1.4087.61 -> 8.2.4133.47
2026-09-11  vivaldi 8.2.4133.52, nvidia-utils/nvidia-open-dkms 610.57.04 -> 615.71.09
```

The live config is the repo's — `~/.config/sway/{rules,styling}` are symlinks into
`packages/sway/`, and the running compositor started 2026-09-11 18:12, well after the last
fix commit (e03c3d4, 2026-09-05). Deployment is not the problem.

Do not spend another session on `for_window` rules. The remaining suspect is **Wayland
explicit sync**: sway advertises `wp_linux_drm_syncobj_manager_v1`, and Chromium binds it
unconditionally on kernel ≥ 6.11 with no switch or feature flag to opt out
(`ui/ozone/platform/wayland/host/wayland_connection.cc`; upstream gates it on a kernel
version precisely because the ioctl path "may cause stability issues"). A release-timeline
point that never gets signalled stalls exactly one surface forever, which is the shape of
what was measured. `WLR_RENDER_NO_EXPLICIT_SYNC=1` in `sway/.local/bin/sway` now stops the
compositor advertising it, so Chromium falls back to implicit sync. Verified in a nested
compositor: the protocol disappears from `wayland-info` with the variable set.

That last step is a hypothesis, not a proof — nothing reproduces the wedge on demand.
If it recurs after a sway restart:

```sh
vivaldi-freeze-probe            # confirms it is the same per-window wedge
vivaldi-freeze-probe --recover  # walks the ladder, ends at the GPU-process restart
wayland-info | grep syncobj     # must print nothing while the opt-out is in place
```

and the next thing to try is `--disable-gpu-memory-buffer-compositor-resources` (pushes
compositor resources to shared memory, off the dmabuf path entirely) — at a real
performance cost, so only if the wedge survives the explicit-sync opt-out.

Two dead ends already ruled out, don't re-walk them: the GPU split is **not** involved
(`renderD129`/`card2` is the Intel iGPU and drives DP-4, and Vivaldi's GPU process already
renders on it — same device, no cross-GPU import), and sway's `geometry` field in
`get_tree` is **not** a configure-ack signal (a live PWA shows an unchanged committed
width after a border nudge, same as a dead window).

## A `#` in `vivaldi-stable.conf` opens ~100 tabs and downloads `vivaldi-bin` (2026-08-09)

`/opt/vivaldi/vivaldi` does **no** comment stripping and **no** quoting:

```sh
VIVALDI_USER_FLAGS="$(cat "$XDG_CONFIG_HOME/vivaldi-$CHROME_VERSION_EXTRA.conf")"   # line 123
exec -a "$0" "$HERE/vivaldi-bin" $VIVALDI_USER_FLAGS "$@"                           # line 133
```

Unquoted expansion word-splits the _entire file_, prose included. Every word of a comment
becomes one argv entry, and Chromium treats each non-`--` argv entry as a URL to open. An
earlier revision of this file carried a 19-line comment block explaining the `--use-gl`
story below. The results:

- **~100 tabs**, one word each. Bare numbers resolve as IPs — `150` became `0.0.0.150`.
- **A download of `file:///opt/vivaldi/vivaldi-bin`**, because the comment quoted a shell
  snippet containing that absolute path, and an existing absolute path is a valid `file:`
  URL pointing at an ELF binary.
- **The flags the comment warned against were actually applied.** Off the live process
  table: `--use-gl=egl --use-gl=disabled --disable-gpu-compositing`, straight out of the
  prose. The comment documenting the SIGILL crash below was re-causing it, and Vivaldi's
  own crash-restart re-read the file — self-sustaining. The `--restart` in the same cmdline
  is that relaunch.

It presents as intermittent only because a running instance absorbs new launches through
its singleton socket; the file is re-parsed solely on a cold start or a crash-restart.

Verify — both must print nothing:

```sh
grep -n '#' ~/.config/vivaldi-stable.conf
pgrep -af vivaldi-bin | grep -o 'use-gl=[a-z]*'
```

## Never use `--use-gl=egl` (2026-08-01)

Chromium 150 (Vivaldi 8.1.4087.48) removed the native EGL/GLES2 GL backend. `--use-gl=egl`
resolves to `(gl=egl-gles2, angle=none)`, which is no longer in the allowed set:

```
ERROR:ui/gl/init/gl_factory.cc:110] Requested GL implementation (gl=egl-gles2,angle=none)
  not found in allowed implementations:
  [(gl=egl-angle,angle=opengl),(gl=egl-angle,angle=opengles),(gl=egl-angle,angle=vulkan)]
ERROR:components/viz/service/main/viz_main_impl.cc:190] Exiting GPU process due to errors
  during initialization
```

Chromium retries GPU init three times, then **gives up on the GPU entirely**. Observable
end state, straight off the running process table:

```
gpu-process ... --use-gl=disabled
every renderer ... --disable-gpu-compositing
```

### Why that closed the browser, not just slowed it

Vivaldi's UI — tab bar, panels, address bar — is itself a web page hosted in an
`--extension-process` renderer. Under software compositing its `Compositor` thread hits a
Chromium `CHECK`, which is compiled to a `ud2` instruction, so it dies with **SIGILL**
(`si_code: ILL_ILLOPN`). Vivaldi notices and restarts the entire browser:

```
ERROR:ui/vivaldi_ui_web_contents_delegate.cc:56] UI Process abnormally terminates with
  status 3 after running for 60117.3 seconds!
ERROR:ui/vivaldi_ui_web_contents_delegate.cc:82] Restarting Vivaldi
```

The window vanishes and relaunches — which reads as "Vivaldi keeps closing itself". Four
occurrences from `coredumpctl`, all `/opt/vivaldi/vivaldi-bin`:

| when             | signal  | thread     | process                               |
| ---------------- | ------- | ---------- | ------------------------------------- |
| 2026-07-29 13:18 | SIGILL  | Compositor | `--extension-process`                 |
| 2026-07-30 14:47 | SIGILL  | Compositor | `--extension-process`                 |
| 2026-08-01 18:12 | SIGILL  | Compositor | `--extension-process`                 |
| 2026-08-01 21:32 | SIGTRAP | main       | browser (relaunched with `--restart`) |

The interval is not fixed — the 18:12 crash came after 16.7 h of uptime — so it presented
as random rather than as a startup failure, even though GPU init had failed at every launch
since the flag was added.

**Fix**: omit `--use-gl` and let Chromium auto-select `egl-angle`. To pin it explicitly use
`--use-angle=gl` (or `=vulkan`); never `--use-gl=egl`.

**Verify after a restart** — this must print nothing:

```sh
pgrep -af 'vivaldi.*--type=gpu-process' | grep -o 'use-gl=disabled'
```

and `chrome://gpu` should show Vulkan/OpenGL backed rather than "Software only".

## Dead flags removed at the same time

- `--enable-features=UseOzonePlatform` — Ozone has been unconditional since Chromium 117.

## `--ozone-platform-hint=auto` is dead in this generation (2026-08-03)

The switch is simply absent from the shipped binaries — it is not a case of being accepted
and ignored, it no longer exists:

```sh
for b in /opt/vivaldi/vivaldi-bin /usr/lib/chromium/chromium /usr/lib/electron43/electron; do
  printf '%s %s\n' "$b" "$(strings "$b" | grep -c ozone-platform-hint)"
done   # → 0 for all three; `ozone-platform` is present
```

Of the installed Electron runtimes, only `electron37` still carries it. So all three flag
files now pin `--ozone-platform=wayland` directly, which takes precedence over the hint
anyway and works on every version present. Vivaldi had been reaching Wayland by
auto-detection alone, not because of the flag.

**`--enable-features=WaylandWindowDecorations` is NOT dead — keep it.** It survives in
electron37 through electron42 and was only dropped in electron43:

```sh
for v in 37 39 40 41 42 43; do
  printf 'electron%s %s\n' "$v" \
    "$(strings /usr/lib/electron$v/electron | grep -c WaylandWindowDecorations)"
done   # → 1 for 37–42, 0 for 43
```

Sampling only `electron43` makes it look removed. It is still load-bearing for the older
runtimes, which are installed and in use.

## GPU/compositor pinning context

`~/.local/bin/sway` pins the compositor to the Intel iGPU by path, not by node number:

```sh
INTEL_PATH="/dev/dri/by-path/pci-0000:00:02.0-card"
export WLR_DRM_DEVICES="$(readlink -f "$INTEL_PATH")"
```

Chromium follows that and passes `--render-node-override=` to its children with whatever
node the compositor advertised. **Do not hardcode `renderD128`/`renderD129` anywhere** —
the numbering is probe-order dependent and swaps between the RTX 3060 (`01:00.0`) and the
UHD 770 (`00:02.0`) across boots. Chromium re-resolves it per launch; leave it alone.

One loose end, not yet acted on: `/usr/share/glvnd/egl_vendor.d/10_nvidia.json` sorts ahead
of `50_mesa.json`, so the GPU process maps `libGLX_nvidia`/`libnvidia-glcore` while holding
the _Intel_ render node. If GPU instability persists after the `--use-gl` fix, pin the
session to Mesa:

```sh
export __EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json
```
