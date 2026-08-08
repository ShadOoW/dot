# mpd — Music Player Daemon

Backend for the `mod+m` ncmpcpp scratchpad (`packages/ncmpcpp`). Config is
`~/.config/mpd/mpd.conf`: library at `/data/media/music`, a PipeWire sink, an HTTP stream on
`:8000`, and a `fifo` output named `my_fifo` at `/tmp/mpd.fifo` that ncmpcpp's visualizer
reads (`visualizer_data_source`/`visualizer_output_name` must keep matching those two).

## mpd runs in the user session on both inits — never as a system service

On Arch that is literal: `meta.json` declares `mpd.service` with `scope: user`.

On Void it needs saying, because the distro pulls the other way. `xbps-install mpd` ships
`/etc/sv/mpd`, and enabling it is the obvious move — it is also wrong here, twice over:

- it runs as the **`mpd` user**, so it reads `/etc/mpd.conf` and never sees this repo's
  config, its library path, or its fifo output;
- it cannot reach shad's **PipeWire** socket (`$XDG_RUNTIME_DIR/pulse/native`), so the
  `pulse` output fails and there is no audio even once it does start.

So `/etc/sv/mpd` is deliberately **not** enabled and `meta.json` declares no runit service.
`packages/sway`'s `exec` block starts mpd for the session instead, guarded to Void so Arch
does not end up with two copies. A dangling `/var/service/mpd -> /etc/sv/mpd` symlink from an
earlier attempt is what `dot doctor` reports as `mpd: not in service dir`; remove it rather
than "fixing" it by installing the system service.

## Verify

```sh
pgrep -a mpd                       # running in the session, owned by shad
mpc status                         # talks to 127.0.0.1:6600
mpc outputs                        # PipeWire Output, my_fifo, MPD HTTP Stream
ls -l /tmp/mpd.fifo                # exists once the fifo output is enabled
```

An empty library is a config problem, not an mpd bug — `mpc update` then `mpc stats`.
