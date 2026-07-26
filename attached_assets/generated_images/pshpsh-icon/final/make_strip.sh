#!/usr/bin/env bash
set -e
DIR="attached_assets/generated_images/pshpsh-icon/final"

make_tile() {
  local key="$1"
  local label="$2"
  magick "${DIR}/${key}.png" \
    -filter Lanczos -resize 300x300 \
    -gravity South -background "#0D0E11" -splice 0x38 \
    -fill white -font DejaVu-Sans-Bold -pointsize 18 \
    -annotate +0+11 "$label" \
    "${DIR}/tile-${key}.png"
  echo "tile: ${DIR}/tile-${key}.png"
}

make_tile "A-sleeping-tabby"  "A  Sleeping tabby"
make_tile "B-slowblink-tabby" "B  Slow-blink tabby"
make_tile "C-eyes-open-tabby" "C  Eyes-open tabby"
make_tile "D-sleeping-calico"  "D  Sleeping calico"
make_tile "E-slowblink-calico" "E  Slow-blink calico"
make_tile "F-wildcard"         "F  Wildcard"

# Row 1: A B C  |  Row 2: D E F
magick \
  \( "${DIR}/tile-A-sleeping-tabby.png"  \
     "${DIR}/tile-B-slowblink-tabby.png" \
     "${DIR}/tile-C-eyes-open-tabby.png" \
     -background "#0D0E11" +append \) \
  \( "${DIR}/tile-D-sleeping-calico.png"  \
     "${DIR}/tile-E-slowblink-calico.png" \
     "${DIR}/tile-F-wildcard.png"         \
     -background "#0D0E11" +append \) \
  -background "#0D0E11" -append \
  -bordercolor "#0D0E11" -border 16 \
  "${DIR}/comparison-final.png"

identify -format 'strip: %wx%h\n' "${DIR}/comparison-final.png"
