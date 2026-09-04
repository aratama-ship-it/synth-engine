# SPEC M0c — wasm32 freestanding ＋ AudioWorklet ＋ OfflineAudioContext

対象: `apps/music-plugins/synth-engine/shells/web/`（新規）。前提: `make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang` で
`build/synth_engine.wasm` ができる（import 0、export-all）。参考実装: `tools/wasm-check/compare.mjs`（node で wasm を駆動する手順・メモリ配置・
`synth_reset(ALL)` がパラメータを初期値に戻す注意点が書いてある。必ず読む）。第三者 JS ライブラリは使わない。

## 作るもの

1. `shells/web/synth-worklet.js` — `AudioWorkletProcessor`
   - `processorOptions.wasmBytes`（ArrayBuffer）を受け取り `WebAssembly.instantiate`（Worklet 内では fetch 不可）。
     `__heap_base` から state／イベント配列／出力バッファを確保、足りなければ `memory.grow`。`synth_create(ptr, size, sampleRate, 128)`
     ただし `process()` は `outputs[0][0].length` を使い 128 固定にしない（maxBlock は 512 で作る）
   - MessagePort 受信: `{type:"preset", params:[[id,value],...]}`、`{type:"events", events:[{frame,kind,id,a,b}...]}`（絶対フレーム）、
     `{type:"reset", kind}`。イベントはリング（4096件）で保持し、ブロックごとにブロック内オフセットへ変換。同一 offset の順序は core が並べ替える
   - オフライン用: `{type:"batch", preset, events}` を開始前に一括投入 → `{type:"ready"}` を返す。`currentFrame` を自前カウンタで持つ
   - 未対応・失敗時は `{type:"error", message}` を返し、無音を出す（例外で Worklet を死なせない）
2. `shells/web/synth-node.js` — メインスレッド側の薄いラッパ `createSynthNode(context, wasmBytes)`。`noteOn(note, vel, atFrame?)`、`noteOff`、`setParam`、`loadPreset(text)`（M0a のプリセット行形式）
3. `shells/web/demo.html`（＋ `demo.js`）
   - 左上に `v0.1.0` 表示。「開始」ボタンで AudioContext を作る（自動再生制限のため）。A〜Z キーで発音（`fixtures` と同じ MIDI 変換: A=60 から半音ずつでよい）
   - 「オフライン10秒レンダー」ボタン: `OfflineAudioContext(2, 10*sr, sr)` に同じ Worklet を載せ、`presets/m0_saw.txt` と `fixtures/m0_events_chord.txt` を batch 投入 →
     `startRendering()` → 32-bit float WAV をダウンロード。同時に peak/rms/nan を画面に表示
   - 「native との比較」欄: `build/out.wav`（CLI 出力）を fetch して同区間の最大差・RMS差（dBFS）を表示
   - 状態表示は画面内（`alert`/`confirm` は使わない）
   - パスは相対: wasm は `../../build/synth_engine.wasm`、preset/fixture/out.wav も `../../` 経由。プロジェクト直下を静的配信する前提
4. `shells/web/README_web.md`: 起動方法（`python3 -m http.server 8963` をプロジェクト直下で）、確認手順、実測値の記録欄

## 完了条件（M0 合否基準 1・3・5）

- Chromium 系ブラウザで demo.html が動き、A〜Z で鳴る。オフラインレンダーで WAV が落ちる（Claude が Browser pane で確認する）
- オフラインレンダー結果と `build/out.wav` の差が RMS −120 dBFS 以下・最大 −100 dBFS 以下（node 実測は −162／−133.6）
- `node --test shells/web/tests/` で、リング変換（絶対→ブロック内）とプリセット行パーサの単体テストが通る
- wasm の生／gzip サイズ、`ready` までの時間、`process()` の平均・p99（`performance.now()`、直近1000ブロック）を画面と README に記録

## やらないこと

- Safari の実機確認（Claude が別途）、UI の作り込み、random-scale-keys への組込。ファイルの削除・移動はしない。`core/`・`Makefile` は編集しない
