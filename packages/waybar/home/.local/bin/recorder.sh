#!/bin/bash
#
# Screen recorder with audio for meetings. Everything the machine is playing is
# captured — the browser included, whichever sink it happens to be pinned to —
# and the microphone on top of it.
#
#   recorder.sh              region mode — drag a region (waybar icon click)
#   recorder.sh full         full output — whole screen, no drag ($mod+Shift+r)
#   recorder.sh full nomic   system audio only, no microphone leg
#
# Either invocation toggles: called again while recording, it stops and cleans up.

MODE="region"
NO_MIC="no"
for arg in "$@"; do
  case "$arg" in
    full) MODE="full" ;;
    region) MODE="region" ;;
    nomic) NO_MIC="yes" ;;
  esac
done

RECORDINGS_DIR="/data/stash/records"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
OUTPUT_PATH="$RECORDINGS_DIR/recording_$TIMESTAMP.mp4"

# State from the in-progress recording (real output path, audio-mix module ids)
STATE_FILE="/tmp/recorder.env"

mkdir -p "$RECORDINGS_DIR"

if pgrep -x "wf-recorder" >/dev/null; then
  # ── Stop ────────────────────────────────────────────────────────────────────
  #
  # SIGINT, NOT SIGTERM, AND THEN WAIT. wf-recorder flushes the encoder and
  # writes the mp4 trailer from its SIGINT handler; a default `pkill` (SIGTERM)
  # ends the process where it stands and leaves a file with no moov atom, which
  # every player reports as a corrupt or zero-length video. The wait matters for
  # the same reason the signal does: unloading the mix while the muxer is still
  # draining pulls the capture source out from under the last buffer.
  pkill -INT -x "wf-recorder"
  for _ in $(seq 100); do
    pgrep -x "wf-recorder" >/dev/null || break
    sleep 0.1
  done

  if [ -f "$STATE_FILE" ]; then
    # shellcheck disable=SC1090
    . "$STATE_FILE"
    # Tear down the audio-mix sink built for this recording
    for id in $MIX_LOOPBACKS; do pactl unload-module "$id" 2>/dev/null; done
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

# ── Audio ─────────────────────────────────────────────────────────────────────
#
# EVERY SINK'S MONITOR GOES INTO THE MIX, not the one that happens to be playing
# when the hotkey is pressed. This used to pick the first RUNNING sink and fall
# back to the default, which is wrong twice over: a meeting usually starts
# recording BEFORE anyone speaks (no sink is RUNNING yet, so it guessed), and
# apps can be pinned to a sink that is not the default — a browser on HDMI while
# the default is the analog jack records silence and reports success. Monitors of
# idle sinks contribute digital silence, so mixing all of them costs nothing and
# removes the guess. A sink that appears mid-recording (a headset plugged in
# after the fact) is still missed; that is the one case left.
SINKS=$(pactl list short sinks | awk '{print $2}' | grep -vx 'meeting_mix')
HW_SINKS=$(printf '%s\n' "$SINKS" | grep -c '^alsa_output\.')

# The mic leg is ON by default and is the default source when that is a real input,
# otherwise the first input the server has. The rule it replaces — USB capture
# devices only — was written for a host where the ReSpeaker Lite array was held
# exclusively by the wake-word service and the only remaining input was an ALC897
# port with nothing in it idling at a ~-29 dB noise floor. Neither is true of this
# machine: there is no array, and an empty jack here measures -99 dB, i.e. digital
# silence. A silent leg costs nothing; a dropped leg costs the meeting.
CAPTURE_MIC=""
if [ "$NO_MIC" != "yes" ]; then
  CAPTURE_MIC=$(pactl get-default-source)
  # @DEFAULT_SOURCE@ is a monitor when no input exists — that is the system audio
  # leg again, and adding it a second time doubles it into the mix.
  case "$CAPTURE_MIC" in *.monitor | '') CAPTURE_MIC="" ;; esac
  [ -z "$CAPTURE_MIC" ] &&
    CAPTURE_MIC=$(pactl list short sources | awk '$2 !~ /\.monitor$/ {print $2; exit}')
fi

# An analog capture device exists whether or not anything is plugged into it, so
# "the mic was recorded and the file is silent" is the default outcome at a desk
# with bare jacks — and afterwards it is indistinguishable from a recorder that
# dropped the mic. The ports say which it is, before the recording rather than
# after listening to it.
# The port list precedes `Active Port:` in pactl's output, so the rows are collected
# first and the verdict is reached at END.
MIC_UNPLUGGED="no"
if [ -n "$CAPTURE_MIC" ]; then
  [ "$(pactl list sources | awk -v want="$CAPTURE_MIC" '
        /^Source #/ { here = 0 }
        $1 == "Name:" { here = ($2 == want) }
        here && $1 == "Active" && $2 == "Port:" { port = $3 }
        here && $1 ~ /:$/ && NF > 1 {
          p = $1; sub(/:$/, "", p)
          avail[p] = index($0, "not available") ? "no" : "yes"
        }
        END { if (port != "" && avail[port] == "no") print "unplugged" }
      ')" = "unplugged" ] && MIC_UNPLUGGED="yes"
fi

MIX_NULL_SINK=$(pactl load-module module-null-sink sink_name=meeting_mix sink_properties=device.description=MeetingMix)
MIX_LOOPBACKS=""
# latency_msec: the default is 200 ms, which lands as 200 ms of audio lag against
# the video. 30 ms is inaudible as lip-sync error and still far above the quantum.
for sink in $SINKS; do
  id=$(pactl load-module module-loopback source="${sink}.monitor" sink=meeting_mix latency_msec=30 2>/dev/null) &&
    MIX_LOOPBACKS="$MIX_LOOPBACKS $id"
done
[ -n "$CAPTURE_MIC" ] && {
  id=$(pactl load-module module-loopback source="$CAPTURE_MIC" sink=meeting_mix latency_msec=30 2>/dev/null) &&
    MIX_LOOPBACKS="$MIX_LOOPBACKS $id"
}

# wf-recorder opens the pulse device immediately; give the null sink a moment to
# register or the audio device open races the module load.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  pactl list short sources | grep -q 'meeting_mix.monitor' && break
  sleep 0.1
done

{
  echo "REAL_OUTPUT_PATH=\"$OUTPUT_PATH\""
  echo "MIX_NULL_SINK=$MIX_NULL_SINK"
  echo "MIX_LOOPBACKS=\"$MIX_LOOPBACKS\""
} >"$STATE_FILE"

if [ "$HW_SINKS" -eq 0 ]; then
  # No card, only PipeWire's `auto_null` placeholder. The recording still runs —
  # video is the point often enough — but it must say so, because a silent file
  # discovered after the meeting is the expensive way to learn it. In the desk
  # container this means the /dev/snd bind or major 116 in the device cgroup is
  # missing: `bin/desktop status` on punk names which.
  AUDIO_DESC="NO AUDIO HARDWARE — this recording will be silent"
elif [ -n "$CAPTURE_MIC" ] && [ "$MIC_UNPLUGGED" = "yes" ]; then
  AUDIO_DESC="system (${HW_SINKS} sink(s)) + mic (${CAPTURE_MIC##*.}) — jack reads as unplugged (unreliable on this codec); recorded anyway"
elif [ -n "$CAPTURE_MIC" ]; then
  AUDIO_DESC="system (${HW_SINKS} sink(s)) + mic (${CAPTURE_MIC##*.})"
else
  AUDIO_DESC="system audio only (${HW_SINKS} sink(s)) — no input device exists"
fi
notify-send "Screen Recording" "Recording ${MODE}: ${AUDIO_DESC}" -i media-record

# waybar's custom/recorder module refreshes on RTMIN+4
echo '{"text": "", "class": "recording", "tooltip": "Recording in progress - Click to stop"}'
pkill -RTMIN+4 waybar

# ── Encode ────────────────────────────────────────────────────────────────────
#
# WHY NOT wl-screenrec, WHICH THIS USED TO RUN. wl-screenrec is VA-API-only: it
# imports the compositor's dmabuf into a VA surface, and `--no-hw` only changes
# what happens AFTER that import. hosts/punk/incus.nix hands this container the
# 3060 and nothing else, so sway exports NVIDIA block-linear buffers and the
# only VA-API driver present is NVIDIA's, which is NVDEC — decode entrypoints,
# no encode. Every invocation died before it wrote a byte:
#
#   Failed to negotiate format: failed to select a viable capture format …
#   modifiers: [NVIDIA_BLOCK_LINEAR_2D,HEIGHT=5,KIND=6 …]
#
# and passing the host's Intel iGPU render node in does not rescue it: i915
# cannot import those modifiers either, which is the same wall one device later.
# The comment that used to live here named renderD129 as "the Intel iGPU with
# VAEntrypointEncSlice" — true of the bare-metal Arch host this script was
# written on, false of the container, where both render nodes are the 3060.
#
# wf-recorder takes the wlr-screencopy shm path instead: the compositor writes
# frames into shared memory and x264 encodes them on the CPU, so it does not
# care which GPU drew them. Measured at 1920x1080/30 on this box: ~2.4 cores and
# ~415 kb/s — fewer bits than the 8 Mbps the VA-API settings aimed at, on a
# 14-core i5-13500 that is otherwise idle during a meeting.
#
#   -c libx264 -p preset=veryfast   the encoder and the speed/size tradeoff
#   -p crf=28                       quality target; a screen share is flat, so
#                                   this is visually lossless on text and small
#   -r 30                           a screen share and three webcam tiles do not
#                                   carry 60 fps of information
#
# Audio stays on the muxer's default AAC: this is the transcript source, and it
# is a rounding error against the video either way.
ENCODE=(-c libx264 -p preset=veryfast -p crf=28 -r 30)

# --audio=DEVICE, attached, long form. wf-recorder's audio flag takes an
# OPTIONAL argument, and getopt only attaches optional arguments that touch the
# flag — so all three of the obvious spellings are wrong in a different way:
#
#   -a DEVICE    → "Using PulseAudio device: default", DEVICE ignored as a
#                  positional; aborts on a pulse assertion when no default
#                  source exists (`Assertion 'p' failed … pa_simple_get_latency`)
#   -a=DEVICE    → the literal "=DEVICE" reaches PulseAudio, which resolves it
#                  to something else without complaining. Measured: an mp4 with
#                  a perfectly healthy AAC track at -91 dB, i.e. digital
#                  silence, from a run that printed no error at all.
#   --audio DEVICE → same as the first.
if [ "$MODE" = "full" ]; then
  wf-recorder "${ENCODE[@]}" -f "$OUTPUT_PATH" --audio=meeting_mix.monitor &
else
  wf-recorder "${ENCODE[@]}" -g "$GEOMETRY" -f "$OUTPUT_PATH" --audio=meeting_mix.monitor &
fi

# A recorder that died in the first second leaves the waybar icon on and the mix
# loaded, and nothing on screen says the file is not being written.
sleep 1
if ! pgrep -x "wf-recorder" >/dev/null; then
  for id in $MIX_LOOPBACKS; do pactl unload-module "$id" 2>/dev/null; done
  pactl unload-module "$MIX_NULL_SINK" 2>/dev/null
  rm -f "$STATE_FILE"
  notify-send "Screen Recording" "FAILED to start — nothing is being recorded" -i dialog-error
  pkill -RTMIN+4 waybar
  exit 1
fi
