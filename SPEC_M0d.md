# SPEC M0d — AU のオフライン出力と CLI 出力を突き合わせる

M0 合否基準の4「同じプリセット＋MIDI を CLI レンダラーでも描き、AU の出力とドライ出力が許容誤差内」が未検証のまま残っている。
これを自動で測る道具を作る。対象: `apps/music-plugins/synth-engine/tools/au-render/`（新規）。

## 前提

- AUv3 は `shells/apple/build.sh` でビルド・署名・登録済み（type `aumu` / subtype `Sken` / manufacturer `Arat`）。
  ビルド先は `~/build/synth-engine/apple/SynthEngineApp.app`（iCloud 外）。
- CLI 側は `build/render-cli`（`SPEC_M0a.md`）。プリセットは `presets/*.txt`、イベントは `fixtures/*.txt`（絶対フレーム）。
- 第三者ライブラリは使わない。Apple 標準（AVFoundation / AudioToolbox）と自作コードのみ。

## 作るもの

### 1. `tools/au-render/main.swift`（コマンドラインツール）

```
au-render --preset presets/m0_saw.txt --events fixtures/m0_events_chord.txt \
          --out build/au_out.wav --sr 48000 --block 128 --frames 96000
```

- `AVAudioUnitComponentManager` で `aumu/Sken/Arat` を探す。見つからなければ終了コード 2 と「AU が登録されていない。先に build.sh を実行」を出す。
- `AVAudioUnit.instantiate(with:options:)` で読み込み、`AVAudioEngine` の **manual rendering mode**
  （`enableManualRenderingMode(.offline, format:maximumFrameCount:)`）で `--sr` / `--block` を指定して接続する。
- プリセットの各行 `paramId=value` を、AU の `parameterTree` の対応する `AUParameter`（address == paramId）へ設定する。
  対応する address が無い paramId は**無視せず、警告を1行出す**（現状 AU は 0〜8 のみ公開）。
- イベントは `AUAudioUnit.scheduleMIDIEventBlock` で送る。ブロックごとに、そのブロック内に入るイベントを
  `AUEventSampleTime(AUEventSampleTimeImmediate + Int64(offsetInBlock))` で予約してから `renderOffline` する。
  - kind 1 = NOTE_ON → MIDI `0x90, note, velocity(0..127)`。`a` が MIDI ノート番号、`b` が 0..1 のベロシティなので `round(b*127)`。
  - kind 2 = NOTE_OFF → `0x80, note, 0`。**note 番号は同じ noteId の NOTE_ON で使われた `a` を引き継ぐ**
    （fixture の NOTE_OFF は `a=0` のため。id → note のマップを持つこと）。
  - kind 3/4（param/macro）は M0d では警告して読み飛ばす。
- 出力は 32-bit float ステレオ WAV（`AVAudioFile` を使ってよい）。
- 標準出力に `peak_dbfs=... rms_dbfs=... nan_count=...` を CLI と同じ書式で出す。

### 2. `tools/au-render/compare.mjs`（node、既存 `tools/wasm-check/compare.mjs` と同じ書式で差分を出す）

- 2つの WAV を読み、フレーム数・最大差・RMS差（dBFS）・ビット一致・NaN 数を出力する。
- 引数: `node tools/au-render/compare.mjs <a.wav> <b.wav>`。
- 既存 `tools/wasm-check/compare.mjs` の WAV パーサを**コピーせずに**、共通部分を `tools/lib/wav.mjs` に切り出して両方から import する
  （既存ファイルの動作は変えないこと。`compare.mjs` の出力書式も変えない）。

### 3. `tools/au-render/build.sh` と `tools/au-render/README.md`

- `swiftc` で `build/au-render` を作る。署名は不要（自分のマシンで動かすだけ）。
- README には、AU 未登録時の対処、既知の差分要因（AU 側のチャンネル構成、ブロック分割の違い）を書く。

## 期待される結果と閾値

- CLI と AU は同じ `core/` を通るので、**理想はビット一致**。ただし AU 側はブロック境界とイベント予約の経路が違うため、
  ずれる可能性がある。まずは**実測値を README と標準出力に記録**し、合否は次で判定する。
  - 最大差 −100 dBFS 以下、RMS 差 −120 dBFS 以下 → PASS（M0 基準3と同じ）
  - これを超えたら FAIL とし、**原因の切り分け（イベント時刻／チャンネル／パラメータ適用のタイミング）を README に書く**。
    原因が AU 側の設計上の差（例: パラメータがブロック境界で反映される）なら、その旨を明記して「仕様上の差」として記録する。

## 制約

- `core/`、`shells/`、`Makefile`、既存の `.md`、`tools/wasm-check/compare.mjs` の**出力書式**は変えない。
- ファイルの削除・移動はしない。生成物は `build/` 配下のみ。
- 音声を再生しない（オフラインレンダーのみ）。

## 完了条件

- `bash tools/au-render/build.sh` が成功。
- `build/au-render --preset presets/m0_saw.txt --events fixtures/m0_events_chord.txt --out build/au_out.wav --sr 48000 --block 128 --frames 96000` が成功し、
  `node tools/au-render/compare.mjs build/out.wav build/au_out.wav` が数値を出す。
- 実測値（最大差・RMS差・ビット一致か）を報告に含める。
