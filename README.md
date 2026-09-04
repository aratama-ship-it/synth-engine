# Synth Engine M0a

SPEC_M0a.md の縦切りスパイクです。第三者コードや外部ライブラリを含まず、DSPコアは
C++標準ライブラリ、動的確保、例外、RTTI、ロックを使いません。公開面は
core/include/synth_engine.h のC ABIです。

## ビルドとテスト

一般形:

    make core
    make cli
    make test
    make core-freestanding-check

このMac（macOS、Apple Clang）で確認した実行例:

    cd "/Users/arata/Library/Mobile Documents/com~apple~CloudDocs/claude code files/apps/music-plugins/synth-engine"
    make test
    make cli
    build/render-cli --preset presets/m0_saw.txt --events fixtures/m0_events_chord.txt \
      --out build/out.wav --sr 48000 --block 128 --frames 96000
    make core-freestanding-check

生成物はすべて build/ 配下に置かれます。CLIは32-bit float、ステレオのWAVを出力し、
標準出力に peak_dbfs、rms_dbfs、nan_count を表示します。

## 入力形式

プリセットは1行に paramId=value、イベントは1行に frame kind id a b を書きます。
空行と # 以降は無視します。イベントの frame は絶対フレームで、CLIがブロック内
オフセットへ変換します。

内蔵wavetableのslotは 0 sine、1 saw、2 square、3 triangle です。

## WASM

WASM_CLANG が未設定なら成功扱いでskipを表示します。LLVM clangのパスを指定する一般形:

    WASM_CLANG=/path/to/clang make wasm

このMacでHomebrew LLVMを使う場合の例:

    WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang make wasm

## テスト8項目

tests/test_main.cpp はフレームワークを使わず、次を測定します。

1. block 1/7/64/128/511のビット一致
2. 同一offsetのイベント順序と1,000イベントfixtureの処理件数
3. NOTE_ON前後の最初の非ゼロフレーム
4. 96k/44.1k/48kと全blockサイズでのNaN、Inf、denormal件数
5. 20音入力時の16ボイス上限とsteal順
6. 同一seed reset後のビット一致とhash決定論
7. fast_sin、fast_cos、fast_exp2 の最大誤差
8. MIDI 108 sawの2048点自作FFTによる簡易エイリアス比

エイリアス測定は4-term Blackman-Harris窓を使い、基音電力に対する「基音より上、かつ
期待される第1〜4倍音の各±10 binを除いた電力」の比です。MIDI 108では選択される
mipの倍音上限が4のため、この4倍音を期待成分とします。

## 未決事項

SPECにないため、以下は公開仕様として確定していません。M0aでは括弧内の暫定挙動です。

- wavetableのslot数と1 slotあたりの最大frame数（4 slot、最大4 frame）
- パラメータ範囲外入力の扱い（各安定範囲へclamp、NaNと未知IDはエラー）
- SYNTH_EV_MACRO の割当先（イベント順序には参加するがM0aでは音声変化なし）
- 未知のイベントkindの扱い（音声変化なし）
- ノートオン時の発振位相（発音フレームを非ゼロにするため0.25 cycle）
- mip段の境界補間（周波数から1段を選ぶhard switch）
- ADSR、level、gain、wavetable slotの初期値（コード内のM0a初期値）
- SYNTH_RESET_VOICES と SYNTH_RESET_ALL のパラメータ保持範囲
  （VOICESはパラメータ保持、ALLはM0a初期値へ戻す）
- カスタムwavetable読込時の振幅正規化（入力のFourier再構成振幅を保持）
- 簡易エイリアス測定の窓、除外bin幅、集計帯域（上記のテスト定義）

## native と wasm の比較（Claude追記 2026-09-04）

```
make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang
node tools/wasm-check/compare.mjs build/synth_engine.wasm presets/m0_saw.txt fixtures/m0_events_chord.txt build/out.wav 48000 128 96000
```
実測: 最大差 −133.6 dBFS、RMS差 −162 dBFS（M0 基準3を満たす）。注意: `synth_reset(ALL)` はパラメータを初期値へ戻すので、プリセット設定後は `reset(VOICES)` を使う。
