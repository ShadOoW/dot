#!/usr/bin/env bash

# Simple Project Manager for Kitty
# Shows fuzzel menu with projects from JSON file and launches them

PROJECTS_FILE="$(dirname "$0")/../projects.json"

# Show menu and get selection
project=$(jq -r '.projects | to_entries[] | "\(.key): \(.value.description)"' "$PROJECTS_FILE" | fuzzel --dmenu --prompt="  Projects  ")

# Exit if nothing selected
[ -z "$project" ] && exit 0

# Extract project key
project_key=$(echo "$project" | cut -d: -f1 | xargs)

# Get project info
info=$(jq -r --arg key "$project_key" '.projects[$key]' "$PROJECTS_FILE")
[ "$info" = "null" ] && exit 1

path=$(echo "$info" | jq -r '.path')
startup_command=$(echo "$info" | jq -r '.startup_command')

# Launch Kitty in project directory
if [ -n "$startup_command" ] && [ "$startup_command" != "null" ]; then
  kitty --directory "$path" -e $startup_command &
else
  kitty --directory "$path" &
fi
