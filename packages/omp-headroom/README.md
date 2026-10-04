# omp-headroom — trial, 2026-10-04 to 2026-10-11

`~/.omp/agent/models.yml` points omp's `anthropic` provider at the local headroom
proxy (`http://127.0.0.1:8787/p/omp`), which compresses tool output before a
request leaves the desk. The proxy is the user unit `headroom-proxy`, declared
with the other desk units in punk-records (`hosts/desktop/default.nix`): a
long-running unit belongs to the machine's NixOS config, not to a dotfile. This
package only redirects omp.

It is its own package, limited to the host `desktop`, because the `omp` package
is linked on every host and no other host runs the proxy. On a host without it,
every omp request would fail.

Every omp request on the desk fails while the proxy is down. `systemctl --user
status headroom-proxy` says why; the off switch is `dot pkg omp-headroom unlink`
and restarting omp.

Never run `headroom wrap omp` or `headroom unwrap omp`: both rewrite
`~/.omp/agent/models.yml`, which is a symlink into this package.

## What was measured before the trial

- Offline, headroom's compressor over 12 recent omp sessions: about 4% fewer
  input tokens (3.9% without its ML model, 4.1% with it). On Arch, with Claude
  Code, its ledger shows 5–20% a day in August (about 10% overall).
- A live omp request through the proxy: 0.15 s added, prompt-cache reads kept.
- The proxy idles at about 0.7 GiB with its ML model, which runs on ONNX
  Runtime. PyTorch (headroom's `ml` extra) added 185 MiB and ran nothing, so the
  install is `uv tool install "headroom-ai[proxy,code]==0.38.0"`.

## Deciding on 2026-10-11

```sh
headroom savings --days 7
```

Its percentage is tokens saved over the input tokens headroom counted. Most of
omp's input is prompt-cache reads, billed at a tenth, so the share of real usage
saved is smaller. This prints both, for requests since the trial began:

```sh
python3 -c 'import json; e=[json.loads(l) for l in open("/home/shad/.headroom/savings_events.jsonl") if l.strip()]; e=[x for x in e if x["ts"]>="2026-10-04T22:48"]; s=sum(x["saved"] for x in e); b=sum(x["before"] for x in e); c=sum(x.get("cache",{}).get("cr",0) for x in e); print(len(e),"requests; saved",s,"of",b,"input tokens (%.1f%%);"%(100*s/max(b,1)),"cache reads",c)'
```

Keep it if the saving is worth 0.7 GiB of RAM and one more process in front of
every request. Otherwise delete this package and the `headroom-proxy` unit in
punk-records together.
