#!/bin/bash
set -e

launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.agentmemory.plist
launchctl kickstart -k gui/$(id -u)/local.agentmemory