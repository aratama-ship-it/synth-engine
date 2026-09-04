# AU offline renderer

`aumu/Sken/Arat` の AUv3 を AVAudioEngine の manual rendering mode でオフライン描画し、32-bit float stereo WAV を出力する。

## ビルド

```sh
bash tools/au-render/build.sh
```

## 実行

AU は先に `shells/apple/build.sh` で署名済みビルドを作り、macOS に登録しておく。

```sh
build/au-render --preset presets/m0_saw.txt --events fixtures/m0_events_chord.txt \
  --out build/au_out.wav --sr 48000 --block 128 --frames 96000
node tools/au-render/compare.mjs build/out.wav build/au_out.wav
```

AU が見つからない場合は、登録が必要であることを示して終了コード 2 で終了する。この Codex 作業では署名・登録・実レンダーは行わず、`swiftc` ビルドまでを確認する。

比較は最大差 -100 dBFS 以下かつ RMS 差 -120 dBFS 以下を PASS とする。既知の差分要因は、AU 側のチャンネル構成、manual rendering のブロック分割、MIDI イベント予約経路、パラメータ適用タイミングである。閾値超過時は、イベント時刻、左右チャンネル、パラメータ適用時点の順で切り分け、実測値と原因をここへ記録する。

## 未決事項

- NOTE_OFF より前に同じ noteId の NOTE_ON がないイベントは、警告して読み飛ばす。
- kind 3/4 は警告して読み飛ばす。警告の重複抑制は行わない。
- 入力イベントのフレームが総フレーム数以上の場合はレンダー対象外とする。
- AU の実測値と、閾値超過時の原因分類は AU 登録環境での検証後に追記する。

## ★iCloud 配下では動かない（2026-09-05 実測・Claude 追記）

`build/au-render`（iCloud 内）から実行すると、AUv3 の読み込みが
`NSOSStatusErrorDomain Code=-1` で失敗する。**同じバイナリを `/tmp` へコピーすると成功する**ので、
コードではなく置き場所の問題。iCloud の `com.apple.provenance` 属性が ad-hoc（linker-signed）署名の検証を壊し、
App Extension のホストになれないと考えられる（`shells/apple/build.sh` の codesign が iCloud で失敗するのと同じ系統）。

そのため `build.sh` の出力先は既定で `~/build/synth-engine/au-render`（iCloud 外）。`SYNTH_BUILD_DIR` で変更できる。
実行はプロジェクト直下から行う（プリセットとフィクスチャを相対パスで読むため）。

```bash
bash tools/au-render/build.sh
~/build/synth-engine/au-render --preset presets/m0_saw.txt --events fixtures/m0_events_chord.txt \
  --out build/au_out.wav --sr 48000 --block 128 --frames 96000
node tools/au-render/compare.mjs build/out.wav build/au_out.wav
```
