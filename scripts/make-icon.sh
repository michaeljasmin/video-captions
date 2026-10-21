#!/bin/zsh
# Régénère les icônes à partir des SVG (à relancer seulement si on change leur design ; nécessite Google Chrome) :
#   assets/icon.svg      → assets/icon-1024.png + assets/Captions.icns       (l'app Captions)
#   assets/icon-test.svg → assets/Captions-test.icns                        (les apps de test, fond vert)
set -e
ROOT="${0:A:h:h}"
TMP=$(mktemp -d)

make_icns() {  # $1 = SVG source, $2 = PNG 1024 px, $3 = .icns
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --default-background-color=00000000 --window-size=1024,1024 \
    --user-data-dir="$TMP/chrome" --screenshot="$2" "file://$1" >/dev/null 2>&1
  local iconset="$TMP/icon.iconset"
  rm -rf "$iconset"; mkdir "$iconset"
  for size in 16 32 128 256 512; do
    sips -z $size $size "$2" --out "$iconset/icon_${size}x${size}.png" >/dev/null
    sips -z $((size * 2)) $((size * 2)) "$2" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$iconset" -o "$3"
  echo "$3"
}

make_icns "$ROOT/assets/icon.svg" "$ROOT/assets/icon-1024.png" "$ROOT/assets/Captions.icns"
make_icns "$ROOT/assets/icon-test.svg" "$TMP/icon-test-1024.png" "$ROOT/assets/Captions-test.icns"
rm -rf "$TMP"
