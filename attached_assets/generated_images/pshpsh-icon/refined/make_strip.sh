#!/usr/bin/env bash
set -e
DIR="attached_assets/generated_images/pshpsh-icon/refined"

make_tile() {
  local key="$1"
  local label="$2"
  local src="${DIR}/${key}.png"
  local out="${DIR}/tile-${key}.png"
  magick "$src" \
    -filter Lanczos -resize 300x300 \
    -gravity South -background "#0D0E11" -splice 0x36 \
    -fill white -font DejaVu-Sans-Bold -pointsize 17 \
    -annotate +0+10 "$label" \
    "$out"
  echo "tile: $out"
}

make_tile "2b-r1" "2-B  R1"
make_tile "2b-r2" "2-B  R2"
make_tile "2b-r3" "2-B  R3"
make_tile "1c-r1" "1-C  R1"
make_tile "1c-r2" "1-C  R2"
make_tile "1c-r3" "1-C  R3"

# Two rows of 3: coral top, teal bottom; 16 px border all around
magick \
  \( "${DIR}/tile-2b-r1.png" "${DIR}/tile-2b-r2.png" "${DIR}/tile-2b-r3.png" \
     -background "#0D0E11" +append \) \
  \( "${DIR}/tile-1c-r1.png" "${DIR}/tile-1c-r2.png" "${DIR}/tile-1c-r3.png" \
     -background "#0D0E11" +append \) \
  -background "#0D0E11" -append \
  -bordercolor "#0D0E11" -border 16 \
  "${DIR}/comparison-refined.png"

identify -format 'strip: %wx%h\n' "${DIR}/comparison-refined.png"
