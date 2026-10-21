#!/bin/zsh
# Compile Captions.app (native/main.swift) et l'installe dans le dossier Applications.
# Construite sur le Mac lui-même : aucun blocage Gatekeeper. « --hash » affiche seulement l'empreinte
# des sources, utilisée par prepare.sh pour savoir s'il faut reconstruire.
set -e
APP_DIR="${0:A:h:h}"
SOURCES=("$APP_DIR/native/main.swift" "$APP_DIR/scripts/build-app.sh" "$APP_DIR/assets/Captions.icns" "$APP_DIR/assets/Captions-test.icns")
HASH=$(cat "${SOURCES[@]}" | shasum | cut -d' ' -f1)
if [[ "$1" == "--hash" ]]; then echo "$HASH"; exit 0; fi

# Un dossier de développement peut se construire une app séparée (ex. « Captions Test ») via un fichier
# .app-name non publié : l'app installée chez l'utilisateur n'est alors jamais remplacée.
NAME=$(cat "$APP_DIR/.app-name" 2>/dev/null || echo Captions)
BUNDLE_ID=com.burotic.captions
ICON="$APP_DIR/assets/Captions.icns"
if [[ "$NAME" != "Captions" ]]; then
  BUNDLE_ID="$BUNDLE_ID.$(echo "$NAME" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')"
  ICON="$APP_DIR/assets/Captions-test.icns"  # fond vert : on la distingue de l'app installée
fi
TMP=$(mktemp -d)
BUILD="$TMP/$NAME.app"
mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources"

xcrun swiftc -O -swift-version 5 -o "$BUILD/Contents/MacOS/Captions" "$APP_DIR/native/main.swift"
cp "$ICON" "$BUILD/Contents/Resources/$NAME.icns"
VERSION=$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo dev)

cat > "$BUILD/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Captions</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleIconFile</key><string>$NAME</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.video</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>CaptionsAppDir</key><string>$APP_DIR</string>
</dict>
</plist>
PLIST
codesign --force --sign - "$BUILD" 2>/dev/null

# /Applications si on peut y écrire (compte administrateur), sinon ~/Applications.
DEST=/Applications
[[ -w $DEST ]] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
rm -rf "$DEST/$NAME.app"
mv "$BUILD" "$DEST/"
rm -rf "$TMP"
touch "$DEST/$NAME.app"  # rafraîchit l'icône dans le Finder
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST/$NAME.app" 2>/dev/null || true
[[ -d "$APP_DIR/.venv" ]] && echo "$HASH" > "$APP_DIR/.venv/.app-hash"
echo "$DEST/$NAME.app"
