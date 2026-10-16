#!/bin/zsh
# Construit Captions.app (une petite app AppleScript qui appelle scripts/launch.sh) et l'installe
# dans le dossier Applications. Construite sur le Mac lui-même : aucun blocage Gatekeeper.
set -e
APP_DIR="${0:A:h:h}"
NAME="Captions"
TMP=$(mktemp -d)
BUILD="$TMP/$NAME.app"

cat > "$TMP/main.applescript" <<EOF
on run
	try
		do shell script "/bin/zsh " & quoted form of "$APP_DIR/scripts/launch.sh"
	on error errMsg
		display dialog "Captions n'a pas pu démarrer." & return & return & errMsg buttons {"OK"} default button "OK" with icon stop with title "Captions"
	end try
end run
EOF

osacompile -o "$BUILD" "$TMP/main.applescript"
cp "$APP_DIR/assets/Captions.icns" "$BUILD/Contents/Resources/applet.icns"
# osacompile ajoute une icône par défaut dans Assets.car (CFBundleIconName), prioritaire sur le .icns : on la retire.
rm -f "$BUILD/Contents/Resources/Assets.car"
plutil -remove CFBundleIconName "$BUILD/Contents/Info.plist" 2>/dev/null || true
plutil -replace CFBundleIdentifier -string "com.burotic.captions" "$BUILD/Contents/Info.plist"
plutil -replace CFBundleName -string "$NAME" "$BUILD/Contents/Info.plist"
codesign --force --deep --sign - "$BUILD" 2>/dev/null

# /Applications si on peut y écrire (compte administrateur), sinon ~/Applications.
DEST=/Applications
[[ -w $DEST ]] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
rm -rf "$DEST/$NAME.app"
mv "$BUILD" "$DEST/"
touch "$DEST/$NAME.app"  # rafraîchit l'icône dans le Finder
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$DEST/$NAME.app" 2>/dev/null || true
rm -rf "$TMP"
echo "$DEST/$NAME.app"
