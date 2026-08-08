#!/bin/bash
set -e

launchctl bootout gui/$(id -u)/local.agentmemory || true
