# Config files (machine-wide, all projects)

Never create or edit a config file directly in `$HOME` or `~/.config`: every dotfile on
this machine is owned by a package in `/data/config/dot` and reaches `$HOME` as a symlink;
a file written directly is silently lost on the next link. Before touching ANY dotfile,
rc file, or anything under `~/.config`, load the `dotfiles` skill — package layout, the
`dot pkg <package> <action>` CLI, host/OS targeting, the early-boot real-file hazard, and
the gates all live there. Verify with `dot doctor`; trust `dot <cmd> --help` over any
prose, including this file.
