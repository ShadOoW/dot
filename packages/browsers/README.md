# browsers — Chromium/Vivaldi/Electron launch flags

Three flag files, each read by a different launcher:

| File                  | Read by                                               | Comments allowed?                                |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| `vivaldi-stable.conf` | `/usr/bin/vivaldi-stable` (shell)                     | **yes** — it does `sed -e '/^\s*#/d'` (line 123) |
| `chromium-flags.conf` | `/usr/bin/chromium` (compiled ELF launcher since 150) | **unverified — keep it comment-free**            |
| `electron.flags.conf` | electron apps                                         | unverified — keep it comment-free                |

Only `vivaldi-stable.conf` has a shell wrapper whose comment-stripping can be read. Arch's
chromium 150 ships a stripped binary launcher, so a `#` line there is an unproven risk for
no benefit. Reasoning that would otherwise be a comment goes here instead.

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
