#!/bin/bash
#
# Screen recorder with audio for meetings. System output is always captured; the
# mic is added only when a usable one exists (see the audio section below).
#
#   recorder.sh              region mode — drag a region (waybar icon click)
#   recorder.sh full         full output — whole screen, no drag ($mod+Shift+r)
#   recorder.sh full mic     force the mic leg on even if the only input is noisy
#
# Either invocation toggles: called again while recording, it stops and cleans up.

MODE="region"
FORCE_MIC="no"
for arg in "$@"; do
  case "$arg" in
    full) MODE="full" ;;
    region) MODE="region" ;;
    mic) FORCE_MIC="yes" ;;
  esac
done

RECORDINGS_DIR="/data/stash/records"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
OUTPUT_PATH="$RECORDINGS_DIR/recording_$TIMESTAMP.mp4"

# State from the in-progress recording (real output path, audio-mix module ids)
STATE_FILE="/tmp/wl-screenrec-recorder.env"

mkdir -p "$RECORDINGS_DIR"

if pgrep -x "wl-screenrec" >/dev/null; then
  # ── Stop ────────────────────────────────────────────────────────────────────
  pkill -x "wl-screenrec"

  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE"
    # Tear down the audio-mix sink built for this recording
    [ -n "$MIX_LOOP_SOURCE" ] && pactl unload-module "$MIX_LOOP_SOURCE" 2>/dev/null
    [ -n "$MIX_LOOP_MONITOR" ] && pactl unload-module "$MIX_LOOP_MONITOR" 2>/dev/null
    [ -n "$MIX_NULL_SINK" ] && pactl unload-module "$MIX_NULL_SINK" 2>/dev/null
    rm -f "$STATE_FILE"
  fi

  # Path is the one recorded at start, not recomputed from this invocation's clock
  notify-send "Screen Recording" "Stopped — saved to ${REAL_OUTPUT_PATH:-$OUTPUT_PATH}" -i video-x-generic
  pkill -RTMIN+4 waybar
  exit 0
fi

# ── Start ─────────────────────────────────────────────────────────────────────

# Clear out audio-mix modules orphaned by a crash/kill of a previous run
for id in $(pactl list short modules | awk '$2=="module-null-sink" && $0 ~ /sink_name=meeting_mix/ {print $1} $2=="module-loopback" && $0 ~ /sink=meeting_mix/ {print $1}'); do
  pactl unload-module "$id" 2>/dev/null
done
rm -f "$STATE_FILE"

GEOMETRY=""
if [ "$MODE" != "full" ]; then
  GEOMETRY=$(slurp -d)
  if [ -z "$GEOMETRY" ]; then
    notify-send "Screen Recording" "Recording cancelled" -i dialog-error
    exit 0
  fi
fi

# Audio. The sink to capture is the one actually playing, not the default: apps can
# be pinned to a sink that is not the default (hdmi vs analog vs USB), and looping
# the default's monitor in that case records silence.
CAPTURE_SINK=$(pactl list short sinks | awk '$NF=="RUNNING" {print $2; exit}')
[ -z "$CAPTURE_SINK" ] && CAPTURE_SINK=$(pactl get-default-sink)

# The mic leg is deliberately conditional. This host's ReSpeaker Lite mic array is
# held exclusively (plughw:CARD=Lite) by the wake-word service (apps/wake), so
# PipeWire exposes no source for it while that runs — and the only remaining input
# is the ALC897 `analog-input-internal-mic` port with nothing attached, which idles
# at a ~-29 dB noise floor and lays broadband hiss over the whole recording
# (measured; a usable mic idles at -60 dB or lower). So: use a USB capture source
# when one exists — that means the array is free and worth recording — otherwise
# record system audio only unless the caller explicitly asked for the mic.
CAPTURE_MIC=$(pactl list short sources | awk '$2 ~ /^alsa_input\.usb-/ {print $2; exit}')
if [ -z "$CAPTURE_MIC" ] && [ "$FORCE_MIC" = "yes" ]; then
  CAPTURE_MIC=$(pactl get-default-source)
fi

MIX_NULL_SINK=$(pactl load-module module-null-sink sink_name=meeting_mix sink_properties=device.description=MeetingMix)
MIX_LOOP_MONITOR=$(pactl load-module module-loopback source="${CAPTURE_SINK}.monitor" sink=meeting_mix)
MIX_LOOP_SOURCE=""
[ -n "$CAPTURE_MIC" ] && MIX_LOOP_SOURCE=$(pactl load-module module-loopback source="$CAPTURE_MIC" sink=meeting_mix)

# wl-screenrec opens the pulse device immediately; give the null sink a moment to
# register or the audio device open races the module load.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  pactl list short sources | grep -q 'meeting_mix.monitor' && break
  sleep 0.1
done

{
  echo "REAL_OUTPUT_PATH=\"$OUTPUT_PATH\""
  echo "MIX_NULL_SINK=$MIX_NULL_SINK"
  echo "MIX_LOOP_MONITOR=$MIX_LOOP_MONITOR"
  echo "MIX_LOOP_SOURCE=$MIX_LOOP_SOURCE"
} >"$STATE_FILE"

if [ -n "$CAPTURE_MIC" ]; then
  AUDIO_DESC="system (${CAPTURE_SINK##*.}) + mic (${CAPTURE_MIC##*.})"
else
  AUDIO_DESC="system audio only (${CAPTURE_SINK##*.}) — no clean mic available"
fi
notify-send "Screen Recording" "Recording ${MODE}: ${AUDIO_DESC}" -i media-record

# waybar's custom/recorder module refreshes on RTMIN+4
echo '{"text": "", "class": "recording", "tooltip": "Recording in progress - Click to stop"}'
pkill -RTMIN+4 waybar

# Encode settings, measured on a 78-minute meeting that landed at 4.85 GB on the defaults.
#
#   --codec hevc   the default is h264; HEVC carries the same screen share in about half the
#                  bits, and every player that matters here reads it.
#   --dri-device   wl-screenrec guesses renderD128, which on this box is the NVIDIA node and
#                  has VA-API decode entrypoints only. renderD129 is the Intel iGPU, and it is
#                  the one with VAEntrypointEncSlice for H264 and HEVC [verified: hevc_vaapi
#                  opens on renderD129 and fails on renderD128 with "no usable encoding
#                  entrypoint"].
#   -m 30          the encoder was being fed 60 fps. A screen share and three webcam tiles do
#                  not carry 60 fps of information, and this halves the file.
#   -b "1 MB"      bytes per second, so 8 Mbps — down from the 40 Mbps default ceiling.
#
# Audio stays on the muxer's default AAC: this is the transcript source, and it is a rounding
# error against the video either way.
ENCODE=(--codec hevc --dri-device /dev/dri/renderD129 -m 30 -b "1 MB")

if [ "$MODE" = "full" ]; then
  wl-screenrec "${ENCODE[@]}" -f "$OUTPUT_PATH" --audio --audio-device meeting_mix.monitor &
else
  wl-screenrec "${ENCODE[@]}" -g "$GEOMETRY" -f "$OUTPUT_PATH" --audio --audio-device meeting_mix.monitor &
fi
