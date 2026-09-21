#!/usr/bin/env python3
# App launcher using fuzzel with proper PTY handling

import os
import sys
import subprocess
import tempfile
import select
import time


def app_dirs():
    """Every applications/ directory, per the XDG basedir spec.

    Not a hard-coded ["~/.local/share/applications", "/usr/share/applications"]:
    that list is correct on Arch and Void and empty on NixOS, where the system
    profile lives in /run/current-system/sw/share and /usr/share does not
    exist. XDG_DATA_DIRS is the portable answer and every distro sets it.
    """
    home = os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share")
    system = os.environ.get("XDG_DATA_DIRS") or "/usr/local/share:/usr/share"
    seen = []
    for base in [home, *system.split(":")]:
        directory = os.path.join(base, "applications")
        if base and os.path.isdir(directory) and directory not in seen:
            seen.append(directory)
    return seen


def get_apps():
    apps = []
    pwas = []

    # Collect from desktop files
    for directory in app_dirs():
        if not os.path.isdir(directory):
            continue
        for filename in os.listdir(directory):
            if not filename.endswith(".desktop"):
                continue
            filepath = os.path.join(directory, filename)
            parse_desktop_file(filepath, apps)

    # Collect PWAs
    pwa_dir = os.path.expanduser("~/.local/share/applications")
    if os.path.isdir(pwa_dir):
        for filename in os.listdir(pwa_dir):
            if filename.startswith("vivaldi-") and filename.endswith(".desktop"):
                filepath = os.path.join(pwa_dir, filename)
                parse_desktop_file(filepath, pwas)

    return apps + pwas


def parse_desktop_file(filepath, app_list):
    try:
        name = None
        exec_cmd = None
        no_display = False
        in_action = False

        with open(filepath, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith("["):
                    if "Desktop Action" in line:
                        in_action = True
                    else:
                        in_action = False
                elif line.startswith("NoDisplay=true"):
                    no_display = True
                elif line.startswith("Name=") and not in_action:
                    name = line.split("=", 1)[1]
                elif line.startswith("Exec=") and not in_action:
                    exec_cmd = line.split("=", 1)[1]

        if name and exec_cmd and not no_display:
            app_list.append((name, exec_cmd))
    except:
        pass


def main():
    apps = get_apps()
    apps.sort(key=lambda x: x[0].lower())

    # Write to temp file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as f:
        for name, _ in apps:
            f.write(name + "\n")
        temp_path = f.name

    # Run fuzzel - it reads from file via stdin redirect
    # Use setsid to detach from terminal properly
    proc = subprocess.Popen(
        ["fuzzel", "-d", "-I", "-p", "Apps  >", "-l", "15", "-w", "40"],
        stdin=open(temp_path, "r"),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    os.unlink(temp_path)

    # Poll for output with timeout
    selected = None
    start = time.time()
    while time.time() - start < 30:
        # Check if process has finished
        ret = proc.poll()
        if ret is not None:
            # Process finished
            if ret == 0:
                stdout = proc.stdout.read().strip()
                if stdout:
                    selected = stdout
            break

        # Check if there's data ready to read
        r, _, _ = select.select([proc.stdout], [], [], 0.5)
        if r:
            # Read available data
            chunk = proc.stdout.read(1024)
            if chunk:
                # Keep reading until newline or process ends
                if b"\n" in chunk or b"\r" in chunk:
                    selected = chunk.decode().strip()
                    proc.terminate()
                    break

    if selected:
        for name, exec_cmd in apps:
            if name == selected:
                print(f"Launching: {name}", file=sys.stderr)
                # Use nohup and setsid to properly detach
                subprocess.Popen(
                    exec_cmd,
                    shell=True,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )
                break
    else:
        proc.terminate()
        proc.wait()


if __name__ == "__main__":
    main()
