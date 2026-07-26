#!/usr/bin/env bash
set -e
D3="attached_assets/generated_images/pshpsh-icon/final3"
ORIG="attached_assets/generated_images/pshpsh-icon/final/B-slowblink-tabby.png"

make_tile() {
  local src="$1" key="$2" line1="$3" line2="$4"
  magick "$src" \
    -filter Lanczos -resize 440x440 \
    -gravity South -background "#0D0E11" -splice 0x60 \
    -fill white -font DejaVu-Sans-Bold -pointsize 20 \
    -annotate +0+38 "$line1" \
    -fill "#6688AA" -font DejaVu-Sans -pointsize 16 \
    -annotate +0+14 "$line2" \
    "${D3}/tile-${key}.png"
  echo "tile: ${D3}/tile-${key}.png"
}

make_tile "$ORIG"           "orig" "ORIGINAL"           "Round-3 B  (incumbent)"
make_tile "${D3}/B-ref1.png" "r1"  "B · R1"             "Curl ring, head in upper arc"
make_tile "${D3}/B-ref2.png" "r2"  "B · R2"             "Slight top-down, tail meets paws"
make_tile "${D3}/B-ref3.png" "r3"  "B · R3"             "Lower arc grounds composition"

magick \
  "${D3}/tile-orig.png" \
  "${D3}/tile-r1.png"   \
  "${D3}/tile-r2.png"   \
  "${D3}/tile-r3.png"   \
  -background "#0D0E11" +append \
  -bordercolor "#0D0E11" -border 16 \
  "${D3}/comparison.png"

identify -format 'strip: %wx%h\n' "${D3}/comparison.png"
