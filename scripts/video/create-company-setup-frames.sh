#!/usr/bin/env bash
set -euo pipefail

OUT="scripts/video/company-setup/frames"
PDF="attached_assets/screencapture-getcompanysync-CompanySetup-2026-09-15-06_11_20_1789467351935.pdf"
RAW="$(mktemp -d)"
mkdir -p "$OUT"
trap 'rm -rf "$RAW"' EXIT

# The PDF embeds the original browser screenshots at 1919px wide. Do not
# render the letter-size PDF pages first; that downsamples the UI and makes
# the final training video permanently soft when it is enlarged.
pdfimages -j "$PDF" "$RAW/page"

SCALE_X=2.0904
SCALE_Y=2.1229

source_page() {
  printf '%s/page-%03d.jpg' "$RAW" "$(( $1 - 1 ))"
}

scale_region() {
  local region="$1"
  local width height x y
  IFS='x+' read -r width height x y <<< "$region"
  awk -v w="$width" -v h="$height" -v x="$x" -v y="$y" \
    -v sx="$SCALE_X" -v sy="$SCALE_Y" \
    'BEGIN { printf "%dx%d+%d+%d", w*sx, h*sy, x*sx, y*sy }'
}

blur_regions() {
  local input="$1"
  local output="$2"
  shift 2
  local args=("$input")
  while (($#)); do
    args+=(-region "$(scale_region "$1")" -blur 0x24 +region)
    shift
  done
  args+=("$output")
  convert "${args[@]}"
}

# Keep the real Company Setup UI while anonymizing tenant and sample contact data.
blur_regions "$(source_page 1)" "$OUT/part1-01.png" \
  "0x0+0+0" \
  "918x75+0+0" \
  "540x42+230+145" \
  "520x30+240+255" \
  "520x30+240+420" \
  "230x30+240+525" \
  "220x30+525+525" \
  "520x30+240+570" \
  "225x30+240+620" \
  "225x30+525+620" \
  "225x30+240+675"

blur_regions "$(source_page 2)" "$OUT/part1-02.png" \
  "300x34+245+300" \
  "300x34+245+670"

blur_regions "$(source_page 3)" "$OUT/part1-03.png" \
  "520x600+205+340"

blur_regions "$(source_page 4)" "$OUT/part2-01.png" \
  "520x300+205+0" \
  "520x360+205+720"

blur_regions "$(source_page 5)" "$OUT/part2-02.png" \
  "520x340+205+0" \
  "520x315+205+520"

blur_regions "$(source_page 6)" "$OUT/part2-03.png" \
  "520x315+205+0" \
  "520x280+205+400"

blur_regions "$(source_page 7)" "$OUT/part3-01.png" \
  "520x300+205+0" \
  "520x260+205+200"

blur_regions "$(source_page 8)" "$OUT/part3-02.png" \
  "520x185+205+160"

cp "$(source_page 9)" "$OUT/part3-03.png"

echo "Created $(find "$OUT" -name '*.png' | wc -l) anonymized Company Setup frames in $OUT"