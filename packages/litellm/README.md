# litellm - LiteLLM Proxy Server

## Installation

```bash
uv tool install 'litellm[proxy]'
```

## Setup

1. **Link system files**: `sudo dot link-system litellm --init runit` or `--init systemd`

   Files linked:
   - `home/.config/litellm/config.yaml` → `~/.config/litellm/config.yaml`
   - `system/runit/etc/sv/litellm/run` → `/etc/sv/litellm/run` (runit only)
   - `system/systemd/etc/systemd/user/litellm.service` → `/etc/systemd/user/litellm.service` (systemd only)

2. **Configure environment variables**:

   ```bash
   export MINIMAX_API_KEY=your_api_key
   export LITELLM_MASTER_KEY=your_master_key
   ```

3. **Enable service**:
   - Runit: `sudo dot enable litellm --init runit`
   - Systemd: `dot enable litellm --init systemd`

## Runit

Service script: `/etc/sv/litellm/run`

Symlink chain:

- `/var/service/litellm` → `/etc/sv/litellm` → `/data/config/dot/packages/litellm/system/runit/etc/sv/litellm`

## Systemd

Service file: `/etc/systemd/user/litellm.service`

Enabled with: `systemctl --user enable litellm.service`

## Config

Default config uses `minimax/minimax-2.7` model. Edit `~/.config/litellm/config.yaml` to customize.

## Clean

```bash
sudo dot unlink-system litellm
```
