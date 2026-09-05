# Synth Engine M1a

SPEC_M0a.md の縦切りスパイクに、SPEC_M1a.md のWT OSC A/B、ユニゾン、B→A位相変調、
サブ、ノイズを追加した実装です。第三者コードや外部ライブラリを含まず、DSPコアは
C++標準ライブラリ、動的確保、例外、RTTI、ロックを使いません。公開面は
core/include/synth_engine.h のC ABIです。

## ビルドとテスト

一般形:

    make core
    make cli
    make test
    make core-freestanding-check

このMac（macOS、Apple Clang）で確認した実行例:

    cd "~/Library/Mobile Documents/com~apple~CloudDocs/claude code files/apps/music-plugins/synth-engine"
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

内蔵wavetableのslotは 0 basic（sine→triangle→saw→squareの4フレーム）、
1 saw、2 square、3 triangleです。slot 0だけがmorphでフレーム間を移動します。

## WASM

WASM_CLANG が未設定なら成功扱いでskipを表示します。LLVM clangのパスを指定する一般形:

    WASM_CLANG=/path/to/clang make wasm

このMacでHomebrew LLVMを使う場合の例:

    WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang make wasm

## テスト21項目

tests/test_main.cpp はフレームワークを使わず、次を測定します。

1. block 1/7/64/128/511のビット一致
2. 同一offsetのイベント順序と1,000イベントfixtureの処理件数
3. NOTE_ON前後の最初の非ゼロフレーム
4. 96k/44.1k/48kと全blockサイズでのNaN、Inf、denormal件数
5. 20音入力時の16ボイス上限とsteal順
6. 同一seed reset後のビット一致とhash決定論
7. fast_sin、fast_cos、fast_exp2 の最大誤差
8. MIDI 108 sawの2048点自作FFTによる簡易エイリアス比
9. ユニゾンのseed決定論
10. 1声と4声のRMS差
11. 2声・±50 centのピーク間隔
12. widthによる左右相関とmono時のビット一致
13. FM無効時のビット一致
14. FM有効時のスペクトル重心
15. MIDI 72 FMの折返し比
16. サブの周波数ピーク
17. ノイズ減衰とseed決定論
18. 100 Hz〜10 kHzのピンクノイズ傾斜
19. 全35パラメータのmin/default/maxスイープ
20. 16音・両OSC 4 unison・サブ・ノイズの処理時間
21. M1a全構成のblock 1/7/64/128/511ビット一致

エイリアス測定は4-term Blackman-Harris窓を使い、基音電力に対する「基音より上、かつ
期待される第1〜4倍音の各±10 binを除いた電力」の比です。MIDI 108では選択される
mipの倍音上限が4のため、この4倍音を期待成分とします。

## M1aで確定した事項

- wavetableは4 slot、1 slotあたり最大4 frame
- slot 0のmorphは隣接2フレームの線形補間
- ユニゾンは等電力パン、合計ゲインは1/sqrt(U)
- B→A位相変調は全開で2 cycle
- ピンクノイズは20 Hz / 200 Hz / 2 kHzの1極LPFを1.0 / 0.32 / 0.10で加算
- パラメータ範囲外はclamp、NaNと未知IDはエラー

## 未決事項

SPECにないため、以下は公開仕様として確定していません。括弧内は現在の挙動です。

- SYNTH_EV_MACRO の割当先（イベント順序には参加するがM0aでは音声変化なし）
- 未知のイベントkindの扱い（音声変化なし）
- OSC Aが1 unisonかつM1a音源がすべて無効なときのphaseMode=0の扱い
  （M0aビット互換を優先して0.25 cycle開始。ユニゾン使用時は仕様どおりhash開始）
- 発音中にunison数、phaseMode、固定phaseを変更した場合の位相再初期化規則
  （現在は再初期化せず、ノートオン時に用意した各位相を継続）
- 発音中にnoiseLevelを0から上げた場合のpink LPF履歴
  （現在はnoiseLevel=0の間はLPFを更新しない）
- ノイズのsampleIndexが2^32 sampleを越えた後のhash規則
  （現在はhash入力の下位32 bitを使う）
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
