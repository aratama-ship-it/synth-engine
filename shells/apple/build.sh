#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
# iCloud 配下だと codesign が「resource fork, Finder information, or similar detritus not allowed」で失敗する（2026-09-04 実測）。
# 既定を iCloud 外にし、SYNTH_BUILD_DIR で上書き可能にする（Claude 修正）。
BUILD_DIR="${SYNTH_BUILD_DIR:-$HOME/build/synth-engine/apple}"
OBJECT_DIR="$BUILD_DIR/objects"
APP_BUNDLE="$BUILD_DIR/SynthEngineApp.app"
APPEX_BUNDLE="$APP_BUNDLE/Contents/PlugIns/SynthEngineAU.appex"
# 署名IDは環境ごとに違うので固定値を持たない。
#   1) SIGN_IDENTITY が指定されていればそれを使う
#   2) 無ければキーチェーンの "Apple Development" 証明書を自動で1つ選ぶ
#   3) それも無ければ ad-hoc 署名（"-"）にフォールバックする
# ★AUv3 拡張は entitlements 付きで署名しないと pluginkit に登録されない。ad-hoc でローカル動作は可能だが、
#   Logic 等の別ホストで読ませるなら Apple Development 以上の証明書を使うこと。
IDENTITY="${SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
    IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null \
        | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -1)"
fi
if [ -z "$IDENTITY" ]; then
    IDENTITY="-"
    echo "warning: Apple Development 証明書が見つからないため ad-hoc 署名（-）を使う。" >&2
    echo "         別ホストで使うなら SIGN_IDENTITY=\"Apple Development: ...\" を指定すること。" >&2
fi
ARCH="$(uname -m)"
TARGET="$ARCH-apple-macos13.0"
CLANGXX="$(xcrun --find clang++)"
SWIFTC="$(xcrun --find swiftc)"
SDK_PATH="$(xcrun --sdk macosx --show-sdk-path)"

mkdir -p "$OBJECT_DIR"
mkdir -p "$BUILD_DIR/module-cache"
mkdir -p "$APPEX_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/MacOS"

echo "[1/7] Validate source property lists"
plutil -lint "$SCRIPT_DIR/Info-AU.plist" "$SCRIPT_DIR/Info-App.plist" \
    "$SCRIPT_DIR/SynthEngineAU.entitlements" "$SCRIPT_DIR/SynthEngineApp.entitlements"

echo "[2/7] Compile DSP core for AUv3"
"$CLANGXX" -std=c++20 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti \
    -target "$TARGET" -isysroot "$SDK_PATH" -I"$ROOT_DIR/core/include" -I"$ROOT_DIR/core/src" \
    -c "$ROOT_DIR/core/src/engine.cpp" -o "$OBJECT_DIR/engine.o"
"$CLANGXX" -std=c++20 -O2 -Wall -Wextra -Werror -fno-exceptions -fno-rtti \
    -target "$TARGET" -isysroot "$SDK_PATH" -I"$ROOT_DIR/core/include" -I"$ROOT_DIR/core/src" \
    -c "$ROOT_DIR/core/src/wavetable.cpp" -o "$OBJECT_DIR/wavetable.o"

echo "[3/7] Build AUv3 extension"
"$CLANGXX" -std=c++20 -O2 -Wall -Wextra -Werror -fobjc-arc -fblocks \
    -fapplication-extension -target "$TARGET" -isysroot "$SDK_PATH" -I"$ROOT_DIR/core/include" \
    -c "$SCRIPT_DIR/SynthEngineAU.mm" -o "$OBJECT_DIR/SynthEngineAU.o"
# App Extension は MH_BUNDLE ではなく実行形式（入口 _NSExtensionMain）でないと entitlements が付かず pluginkit に登録されない（2026-09-04 実測。Claude 修正）
"$CLANGXX" -e _NSExtensionMain -fapplication-extension -target "$TARGET" -isysroot "$SDK_PATH" \
    "$OBJECT_DIR/SynthEngineAU.o" "$OBJECT_DIR/engine.o" "$OBJECT_DIR/wavetable.o" \
    -framework Foundation -framework AudioToolbox -framework AVFAudio \
    -o "$APPEX_BUNDLE/Contents/MacOS/SynthEngineAU"
plutil -convert binary1 -o "$APPEX_BUNDLE/Contents/Info.plist" "$SCRIPT_DIR/Info-AU.plist"

echo "[4/7] Build Swift standalone app"
"$CLANGXX" -std=c++20 -O2 -Wall -Wextra -Werror -target "$TARGET" -isysroot "$SDK_PATH" \
    -c "$SCRIPT_DIR/MIDIInput.cpp" -o "$OBJECT_DIR/MIDIInput.o"
"$SWIFTC" -O -target "$TARGET" -sdk "$SDK_PATH" \
    -module-cache-path "$BUILD_DIR/module-cache" \
    "$SCRIPT_DIR/main.swift" "$OBJECT_DIR/MIDIInput.o" \
    -framework AppKit -framework AVFoundation -framework AudioToolbox -framework CoreMIDI \
    -o "$APP_BUNDLE/Contents/MacOS/SynthEngineApp"
plutil -convert binary1 -o "$APP_BUNDLE/Contents/Info.plist" "$SCRIPT_DIR/Info-App.plist"

echo "[5/7] Locate signing identity"
if [ "$IDENTITY" != "-" ] && ! security find-identity -v -p codesigning | grep -Fq "$IDENTITY"; then
    echo "error: signing identity is not available to this process:" >&2
    echo "  $IDENTITY" >&2
    echo "Open Keychain Access, import/unlock the certificate and private key, then rerun:" >&2
    echo "  bash shells/apple/build.sh" >&2
    exit 70
fi

echo "[6/7] Sign extension and containing app"
xattr -cr "$APP_BUNDLE" 2>/dev/null || true
codesign --force --timestamp=none --sign "$IDENTITY" \
    --entitlements "$SCRIPT_DIR/SynthEngineAU.entitlements" "$APPEX_BUNDLE"
codesign --force --timestamp=none --sign "$IDENTITY" \
    --entitlements "$SCRIPT_DIR/SynthEngineApp.entitlements" "$APP_BUNDLE"
codesign --verify --deep --strict --verbose=2 "$APP_BUNDLE"

echo "[7/7] Register embedded AUv3"
pluginkit -a "$APPEX_BUNDLE"
pluginkit -m -v -i com.pygmix.synthengine.au

echo "Build succeeded: $APP_BUNDLE"
