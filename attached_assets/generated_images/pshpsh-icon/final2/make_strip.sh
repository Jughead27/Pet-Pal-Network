#!/usr/bin/env bash
set -e
DIR="attached_assets/generated_images/pshpsh-icon/final2"

make_tile() {
  local key="$1" line1="$2" line2="$3"
  magick "${DIR}/${key}.png" \
    -filter Lanczos -resize 440x440 \
    -gravity South -background "#0D0E11" -splice 0x56 \
    -fill white -font DejaVu-Sans-Bold -pointsize 20 \
    -annotate +0+34 "$line1" \
    -font DejaVu-Sans -pointsize 17 \
    -fill "#8899AA" \
    -annotate +0+12 "$line2" \
    "${DIR}/tile-${key}.png"
  echo "tile: ${DIR}/tile-${key}.png"
}

make_tile "D1-v1" "D1 · V1" "Curl cradle — restrained lower mass"
make_tile "D1-v2" "D1 · V2" "Floating cradle — airy chin"
make_tile "D2-v1" "D2 · V1" "Full-frame calm flow"
make_tile "D2-v2" "D2 · V2" "Full-frame deep corner vignette"

# Single row of 4
magick \
  "${DIR}/tile-D1-v1.png" \
  "${DIR}/tile-D1-v2.png" \
  "${DIR}/tile-D2-v1.png" \
  "${DIR}/tile-D2-v2.png" \
  -background "#0D0E11" +append \
  -bordercolor "#0D0E11" -border 16 \
  "${DIR}/comparison.png"

identify -format 'strip: %wx%h\n' "${DIR}/comparison.png"
