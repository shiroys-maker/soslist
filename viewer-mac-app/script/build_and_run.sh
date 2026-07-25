#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="SOS Appointment Viewer"
PRODUCT_NAME="SOSAppointmentViewerApp"
BUILD_DIR="/private/tmp/SOSAppointmentViewerBuild"
APP_DIR="$BUILD_DIR/dist/$APP_NAME.app"
BIN_PATH="$BUILD_DIR/.build/release/$PRODUCT_NAME"
SOURCE_ICON="/Users/shungohiroyasu/Documents/GitHub/soslist/stamp.png"
WEB_RESOURCES_DIR="$APP_DIR/Contents/Resources/root-web"
ICONSET_DIR="$BUILD_DIR/$PRODUCT_NAME.iconset"
ICNS_PATH="$APP_DIR/Contents/Resources/AppIcon.icns"

if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  pkill -x "$APP_NAME" || true
  sleep 1
fi

swift build --package-path "$ROOT_DIR" -c release --build-path "$BUILD_DIR/.build"

rm -rf "$APP_DIR"
rm -rf "$ICONSET_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources" "$ICONSET_DIR" "$WEB_RESOURCES_DIR"

cp "$BIN_PATH" "$APP_DIR/Contents/MacOS/$APP_NAME"
cp /Users/shungohiroyasu/Documents/GitHub/soslist/index.html "$WEB_RESOURCES_DIR/"
cp /Users/shungohiroyasu/Documents/GitHub/soslist/summary-viewer.html "$WEB_RESOURCES_DIR/"
cp /Users/shungohiroyasu/Documents/GitHub/soslist/script.js "$WEB_RESOURCES_DIR/"
cp /Users/shungohiroyasu/Documents/GitHub/soslist/style.css "$WEB_RESOURCES_DIR/"
cp /Users/shungohiroyasu/Documents/GitHub/soslist/config.js "$WEB_RESOURCES_DIR/"
cp "$SOURCE_ICON" "$WEB_RESOURCES_DIR/stamp.png"

sips -z 16 16 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET_DIR" -o "$ICNS_PATH"

cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>SOS Appointment Viewer</string>
  <key>CFBundleIdentifier</key>
  <string>jp.niraissc.sos.viewer</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleName</key>
  <string>SOS Appointment Viewer</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

open -n "$APP_DIR"

echo "$APP_DIR"
