# GRUB Setup

## Themes

Two themes are managed by the asset manager:

```
dot assets sync arch-linux-grub   # Arch Linux theme from AdisonCavani/distro-grub-themes
dot assets sync grub-theme        # Custom personal theme (cloned from git)
```

Both install to `/boot/grub/themes/` and require sudo.

## Configuration

Edit `/etc/default/grub`:

```ini
GRUB_THEME="/boot/grub/themes/shad/theme.txt"
GRUB_DEFAULT=saved
GRUB_SAVEDEFAULT=true
GRUB_TIMEOUT=15
GRUB_GFXMODE=1920x1080x32,auto
GRUB_PRELOAD_MODULES="part_gpt part_msdos efi_gop all_video"
```

Regenerate GRUB config after changes:

```
sudo grub-mkconfig -o /boot/grub/grub.cfg
```

## Memory: `zswap.enabled=0` (required)

This box runs zram swap. zswap in front of zram double-compresses every anon page and adds an
allocate-to-reclaim step ahead of `zsmalloc`'s — the mechanism behind the 2026-07/08 freezes.
linux-zen ships `CONFIG_ZSWAP_DEFAULT_ON=y`, so **doing nothing means it is on**.

Add to `GRUB_CMDLINE_LINUX_DEFAULT`:

```
zswap.enabled=0
```

The cmdline is the authoritative switch because it applies before any swap device is
activated. `packages/zram` also ships a `tmpfiles.d` entry as a backstop in case this
parameter is ever dropped — but that runs at `sysinit.target`, i.e. later. Keep both.

Verify after reboot:

```sh
cat /sys/module/zswap/parameters/enabled   # want N
```

Background: `docs/zram.md`, "zswap was stacked in front of zram the whole time".

## Intel GPU + Wayland

For Intel Gen9+ GPU (i915) with Wayland, add to `GRUB_CMDLINE_LINUX_DEFAULT`:

```
i915.enable_psr=0 i915.enable_fbc=0
```

- `i915.enable_psr=0` - Disables Panel Self Refresh (causes flip hangs on Gen9+)
- `i915.enable_fbc=0` - Disables Framebuffer Compression

## NVIDIA

For hybrid Intel+NVIDIA setups, full `GRUB_CMDLINE_LINUX_DEFAULT`:

```
loglevel=3 i915.enable_psr=0 i915.enable_fbc=0 nvidia-drm.modeset=1 nvidia.NVreg_PreserveVideoMemoryAllocations=0
```

- `nvidia-drm.modeset=1` - Enable DRM modesetting for NVIDIA
- `nvidia.NVreg_PreserveVideoMemoryAllocations=0` - Prevents memory leaks with suspend/resume

After editing `/etc/default/grub`, regenerate config:

```
sudo grub-mkconfig -o /boot/grub/grub.cfg
```
