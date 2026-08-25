# Snapper (BTRFS Snapshots)

Snapper automates BTRFS snapshots for system rollback.

## Package

```
xbps-install snapper   # Void Linux
pacman -S snapper       # Arch Linux
```

## Configuration

The config is installed from this repo by the package's setup script (the package
ships no `home/`/`system/` tree, so there is nothing to link):

```
sudo packages/snapper-config/setup.sh   # installs /etc/snapper/configs/root
```

## Note

Remove Timeshift if installed — it conflicts with snapper's BTRFS subvolume layout:

```
sudo pacman -Rns timeshift
```
