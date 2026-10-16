#!/bin/zsh
# Régénère assets/icon-1024.png et assets/Captions.icns à partir de assets/icon.svg
# (à relancer seulement si on change le design de l'icône ; nécessite Google Chrome).
set -e
ROOT="${0:A:h:h}"
TMP=$(mktemp -d)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --default-background-color=00000000 --window-size=1024,1024 \
  --user-data-dir="$TMP/chrome" --screenshot="$ROOT/assets/icon-1024.png" "file://$ROOT/assets/icon.svg" >/dev/null 2>&1

ICONSET="$TMP/Captions.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z $size $size "$ROOT/assets/icon-1024.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) "$ROOT/assets/icon-1024.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$ROOT/assets/Captions.icns"
rm -rf "$TMP"
echo "$ROOT/assets/Captions.icns"
