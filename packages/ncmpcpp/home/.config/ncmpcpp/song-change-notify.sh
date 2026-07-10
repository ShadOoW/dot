#!/bin/bash

# Check if MPD is actually playing
PLAYING=$(mpc status | grep -c "playing")
if [ "$PLAYING" -eq 0 ]; then
  # Not playing, don't show notification
  exit 0
fi

# Get song information
TITLE=$(mpc --format '%title%' current)
ARTIST=$(mpc --format '%artist%' current)
ALBUM=$(mpc --format '%album%' current)
FILENAME=$(mpc --format '%file%' current | awk -F'/' '{print $NF}')

# Build notification message
if [ -z "$TITLE" ]; then
  # No title, use filename as title
  MESSAGE="$FILENAME"
else
  MESSAGE="$TITLE"

  # Add artist information if available
  if [ -n "$ARTIST" ]; then
    MESSAGE="$MESSAGE
        
$ARTIST"

    # Add album information if available
    if [ -n "$ALBUM" ]; then
      MESSAGE="$MESSAGE - $ALBUM"
    fi
  fi
fi

# Use a consistent ID (27072) for notifications to replace previous ones
# The --replace option will close any existing notification with the same ID
# Use music-note.jpg as the notification icon
ICON_PATH="/data/config/dot/packages/ncmpcpp/music-note.jpg"

# Check if the icon exists, if not, don't specify an icon
if [ -f "$ICON_PATH" ]; then
  fyi -i "$ICON_PATH" -c mpd --replace=27072 "MPD" "$MESSAGE"
else
  fyi -c mpd --replace=27072 "MPD" "$MESSAGE"
fi
