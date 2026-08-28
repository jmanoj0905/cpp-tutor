#!/usr/bin/env bash
# Regenerates media/icon.png, the 256x256 marketplace listing icon.
#
# Not the same artwork as media/icon.svg: that one is the activity-bar glyph,
# monochrome `currentColor` line art the editor tints to match the theme, which
# the marketplace would render as an invisible smudge on its own background.
# This one carries the project's own colours -- white panel, dotted black
# border, blue pointer arrow, yellow "changed value" bar.
#
# Drawn with ImageMagick primitives rather than rendered from an SVG on
# purpose: ImageMagick's built-in MSVG renderer silently drops most of a real
# SVG (it produced a blank white square), and requiring librsvg just to rebuild
# one committed PNG is not worth it.
set -euo pipefail
cd "$(dirname "$0")/.."

magick -size 256x256 xc:white \
  -fill none -stroke '#111111' \
  -strokewidth 4  -draw "stroke-dasharray 10,10 rectangle 14,14 242,242" \
  -strokewidth 12 -draw "stroke-dasharray none rectangle 40,64 112,120" \
  -draw "rectangle 40,140 112,196" \
  -draw "rectangle 176,64 216,120" \
  -stroke '#2452cc' -draw "line 112,92 168,92" -draw "polyline 148,72 168,92 148,112" \
  -stroke '#f2b100' -draw "line 112,168 216,168" \
  -depth 8 media/icon.png

magick identify media/icon.png
