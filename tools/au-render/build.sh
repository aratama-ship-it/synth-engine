#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../.."

# ★iCloud 配下に置いた実行ファイルからは AUv3 拡張を読み込めない（2026-09-05 実測。
#   同じバイナリを /tmp へコピーすると成功する。iCloud の provenance 属性が
#   ad-hoc 署名の検証を壊し、App Extension のホストになれないため）。
#   したがって成果物は既定で iCloud 外へ置く。SYNTH_BUILD_DIR で上書きできる。
BUILD_DIR="${SYNTH_BUILD_DIR:-$HOME/build/synth-engine}"
mkdir -p "$BUILD_DIR"

xcrun swiftc -O tools/au-render/main.swift \
  -module-cache-path "$BUILD_DIR/swift-module-cache" \
  -framework AVFoundation -framework AudioToolbox \
  -o "$BUILD_DIR/au-render"

echo "built: $BUILD_DIR/au-render"
echo "使い方の例（プロジェクト直下で）:"
echo "  \"$BUILD_DIR/au-render\" --preset presets/m0_saw.txt --events fixtures/m0_events_chord.txt --out build/au_out.wav --sr 48000 --block 128 --frames 96000"
