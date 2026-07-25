#!/bin/bash
# SOSList Local.app をビルドする。
#   usage: build_and_run.sh [--install] [--no-run]
#     --install : ビルド後に /Applications へ入れ替える
#     --no-run  : ビルドのみ（起動しない）
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$ROOT_DIR/../.." && pwd)"
APP_NAME="SOSList Local"
PRODUCT_NAME="SOSListLocalApp"
# /private/tmp はOSに掃除されるため、リポジトリ内の恒久ディレクトリ（gitignore済み）に置く
BUILD_DIR="$ROOT_DIR/build"
APP_DIR="$BUILD_DIR/dist/$APP_NAME.app"
BIN_PATH="$BUILD_DIR/.build/release/$PRODUCT_NAME"
SOURCE_ICON="$REPO_DIR/stamp.png"
LOCAL_SOURCE_DIR="$REPO_DIR/local"
SHARED_SOURCE_DIR="$REPO_DIR/shared"
ICONSET_DIR="$BUILD_DIR/$PRODUCT_NAME.iconset"
ICNS_PATH="$APP_DIR/Contents/Resources/AppIcon.icns"
WEB_RESOURCES_DIR="$APP_DIR/Contents/Resources/local-web"

DO_INSTALL=0
DO_RUN=1
for arg in "$@"; do
  case "$arg" in
    --install) DO_INSTALL=1 ;;
    --no-run)  DO_RUN=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

BUILD_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

if pgrep -x "$APP_NAME" >/dev/null 2>&1; then
  pkill -x "$APP_NAME" || true
  sleep 1
fi

swift build --package-path "$ROOT_DIR" -c release --build-path "$BUILD_DIR/.build"

rm -rf "$APP_DIR"
rm -rf "$ICONSET_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources" "$ICONSET_DIR" \
         "$WEB_RESOURCES_DIR/local" "$WEB_RESOURCES_DIR/shared"

cp "$BIN_PATH" "$APP_DIR/Contents/MacOS/$APP_NAME"

# ランタイムに必要なファイルだけをバンドルする
# （config.js・mac-app/ソース・README等を同梱しない）
for f in index.html script.js style.css details.html details.js; do
  cp "$LOCAL_SOURCE_DIR/$f" "$WEB_RESOURCES_DIR/local/"
done
cp "$SHARED_SOURCE_DIR/core.js" "$WEB_RESOURCES_DIR/shared/"
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

cat > "$APP_DIR/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>SOSList Local</string>
  <key>CFBundleIdentifier</key>
  <string>jp.niraissc.soslist.local</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleName</key>
  <string>SOSList Local</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>${BUILD_SHA}</string>
  <key>SOSListBuildSHA</key>
  <string>${BUILD_SHA}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST

# ad-hoc署名（無署名だと初回起動でGatekeeperに弾かれることがある）
codesign --force --deep --sign - "$APP_DIR" 2>/dev/null || true

if [ "$DO_INSTALL" -eq 1 ]; then
  ditto "$APP_DIR" "/Applications/$APP_NAME.app.new"
  rm -rf "/Applications/$APP_NAME.app"
  mv "/Applications/$APP_NAME.app.new" "/Applications/$APP_NAME.app"
  echo "installed: /Applications/$APP_NAME.app (build $BUILD_SHA)"
  [ "$DO_RUN" -eq 1 ] && open -n "/Applications/$APP_NAME.app"
else
  [ "$DO_RUN" -eq 1 ] && open -n "$APP_DIR"
  echo "$APP_DIR (build $BUILD_SHA)"
fi
