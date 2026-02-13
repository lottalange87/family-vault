#!/bin/bash
# scripts/process-video.sh - Convert video to fMP4 segments for streaming

INPUT_FILE="$1"
OUTPUT_DIR="$2"
SEGMENT_DURATION="${3:-4}"  # Default 4 seconds per segment

if [ -z "$INPUT_FILE" ] || [ -z "$OUTPUT_DIR" ]; then
    echo "Usage: $0 <input-video> <output-dir> [segment-duration-seconds]"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

# Generate fMP4 segments with ffmpeg
# Using DASH-compatible fragmentation
ffmpeg -i "$INPUT_FILE" \
    -c copy \
    -f dash \
    -seg_duration ${SEGMENT_DURATION} \
    -frag_duration ${SEGMENT_DURATION}000000 \
    -movflags frag_keyframe+empty_moov+default_base_moof \
    -use_template 1 \
    -use_timeline 1 \
    -init_seg_name "init.mp4" \
    -media_seg_name "segment_$Number%05d$.m4s" \
    "$OUTPUT_DIR/manifest.mpd"

# Also generate a simple JSON manifest for our custom player
ffmpeg -i "$INPUT_FILE" -f ffmetadata "$OUTPUT_DIR/metadata.txt" 2>/dev/null || true

# Get video info
DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE")
WIDTH=$(ffprobe -v error -show_entries stream=width -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" | head -1)
HEIGHT=$(ffprobe -v error -show_entries stream=height -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" | head -1)
CODEC=$(ffprobe -v error -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "$INPUT_FILE" | head -1)

echo "Processing complete:"
echo "  Duration: ${DURATION}s"
echo "  Resolution: ${WIDTH}x${HEIGHT}"
echo "  Codec: ${CODEC}"
echo "  Output: $OUTPUT_DIR"
