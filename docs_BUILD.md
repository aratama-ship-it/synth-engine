# Synth Engine M1b

SPEC_M0a.md の縦切りスパイクに、SPEC_M1a.md のWT OSC A/B、ユニゾン、B→A位相変調、
サブ、ノイズ、およびSPEC_M1b.mdのTPT/ZDF SVF、フィルタEG、LFOを追加した実装です。
第三者コードや外部ライブラリを含まず、DSPコアは
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
    build/render-cli --preset presets/m1b_filter_sweep.txt --events fixtures/m0_events_chord.txt \
      --out build/m1b_filter_sweep.wav --sr 48000 --block 128 --frames 96000
    make core-freestanding-check

生成物はすべて build/ 配下に置かれます。CLIは32-bit float、ステレオのWAVを出力し、
標準出力に peak_dbfs、rms_dbfs、nan_count を表示します。

## 入力形式

プリセットは1行に paramId=value、イベントは1行に frame kind id a b を書きます。
空行と # 以降は無視します。イベントの frame は絶対フレームで、CLIがブロック内
オフセットへ変換します。

内蔵wavetableのslotは 0 basic（sine→triangle→saw→squareの4フレーム）、
1 saw、2 square、3 triangleです。slot 0だけがmorphでフレーム間を移動します。

## パラメータ一覧（engine version 5）

| ID | 名前 | 範囲 | 既定 |
|---:|---|---:|---:|
| 0 | oscAWavetable | 0..3 | 0 |
| 1 | oscAMorph | 0..1 | 0 |
| 2 | oscALevel | 0..4 | 0.8 |
| 3 | ampAttack | 0..60 s | 0.005 |
| 4 | ampDecay | 0..60 s | 0.1 |
| 5 | ampSustain | 0..1 | 0.8 |
| 6 | ampRelease | 0..60 s | 0.2 |
| 7 | masterGain | 0..4 | 0.2 |
| 8 | voiceCount | 1..16 int | 16 |
| 9 | oscAUnison | 1..4 int | 1 |
| 10 | oscADetune | 0..50 cent | 10 |
| 11 | oscAWidth | 0..1 | 0.5 |
| 12 | oscAOctave | -2..2 int | 0 |
| 13 | oscASemitone | -12..12 int | 0 |
| 14 | oscAFine | -100..100 cent | 0 |
| 15 | oscAPhaseMode | 0..1 int | 0 |
| 16 | oscAPhase | 0..1 | 0 |
| 17 | oscBWavetable | 0..3 int | 0 |
| 18 | oscBMorph | 0..1 | 0 |
| 19 | oscBLevel | 0..4 | 0 |
| 20 | oscBUnison | 1..4 int | 1 |
| 21 | oscBDetune | 0..50 cent | 10 |
| 22 | oscBWidth | 0..1 | 0.5 |
| 23 | oscBOctave | -2..2 int | 0 |
| 24 | oscBSemitone | -12..12 int | 0 |
| 25 | oscBFine | -100..100 cent | 0 |
| 26 | oscBPhaseMode | 0..1 int | 0 |
| 27 | oscBPhase | 0..1 | 0 |
| 28 | fmBToA | 0..1 | 0 |
| 29 | subLevel | 0..4 | 0 |
| 30 | subShape | 0..2 int | 0 |
| 31 | subOctave | -2..0 int | -1 |
| 32 | noiseLevel | 0..4 | 0 |
| 33 | noiseColor | 0..1 int | 0 |
| 34 | noiseDecay | 0..60 s | 0.05 |
| 35 | filterEnabled | 0..1 int | 0 |
| 36 | filterMode | 0..5 int | 0 |
| 37 | filterCutoff | 20..20000 Hz | 20000 |
| 38 | filterResonance | 0..1 | 0 |
| 39 | filterKeyTrack | 0..1 | 0 |
| 40 | filterEnvAmount | -8..8 oct | 0 |
| 41 | filterEgAttack | 0..20 s | 0.005 |
| 42 | filterEgDecay | 0..20 s | 0.2 |
| 43 | filterEgSustain | 0..1 | 1 |
| 44 | filterEgRelease | 0..20 s | 0.2 |
| 45 | filterVelToEnv | 0..1 | 0 |
| 46 | lfoRate | 0.01..40 Hz | 1 |
| 47 | lfoShape | 0..5 int | 0 |
| 48 | lfoRetrigger | 0..1 int | 0 |
| 49 | lfoToCutoff | -8..8 oct | 0 |
| 50 | lfoToPitch | -1200..1200 cent | 0 |
| 51 | lfoToAmp | 0..1 | 0 |
| 52 | lfoPhase | 0..1 | 0 |
| 53 | ampEgCurve | 0..1 | 0 |
| 54 | filterEgCurve | 0..1 | 0 |

filterModeは0=LP12、1=BP12、2=HP12、3=Notch、4=LP24、5=HP24です。
lfoShapeは0=sine、1=triangle、2=saw上行、3=saw下行、4=square、5=S&Hです。
ampEgCurveとfilterEgCurveは、各EGのディケイ／リリースに共通して作用します。
0は従来の指数カーブ、1は直線、その間は正規化した指数カーブと直線の補間です。
アタックは従来どおり直線です。curve=0は従来の演算経路と終了判定をそのまま使います。
curve>0では進行度を経過サンプル数から求め、ディケイ／リリースの区間長は指定秒ちょうど
（端数がある場合は目標へ到達する最初のサンプル）になります。

## WASM

WASM_CLANG が未設定なら成功扱いでskipを表示します。LLVM clangのパスを指定する一般形:

    WASM_CLANG=/path/to/clang make wasm

このMacでHomebrew LLVMを使う場合の例:

    WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang make wasm

## テスト41項目

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
19. 全55パラメータのmin/default/maxスイープ
20. 16音・両OSC 4 unison・サブ・ノイズの処理時間
21. M1a全構成のblock 1/7/64/128/511ビット一致
22. M0 saw／M1 unisonの基準WAVとのビット一致
23. LP12の200／1000／5000 Hzにおける−3 dB点
24. LP12／LP24の阻止帯域スロープ
25. resonance 0.8のカットオフ付近のピーク差
26. resonance 1・無入力・10秒の安定性
27. 40 Hz LFO・±8 octave・LP24の高速変調安定性
28. C3／C4の1:1キートラック倍率
29. filterEnvAmount 4・decay 0.3秒のスペクトル重心比
30. LFO 6波形の範囲・周期とS&H決定論
31. LFOリトリガー／フリーランの位相挙動
32. フィルタ＋LFO有効時のblock 1/7/64/128/511ビット一致
33. 全M1b機能有効時のreset後レンダー決定論
34. LP24・LFO・16音×unison 4の平均／p99処理時間と期限判定
35. curve=0を明示したM0 saw／M1 unisonの基準WAVとのビット一致、および55パラメータのメタデータ
36. 直線フィルタEGのディケイ25%／50%／75%時点での実測値
37. curve 0／0.5／1でエンベロープが0.5へ落ちる時刻の単調増加
38. curve、decay、releaseの全80組合せでNaN／Inf、振幅上限、リリース後のボイス解放
39. M0a sawをM1b-3基準WAV `/tmp/g3_m0.wav` と比較したビット一致
40. 同じ演奏のイベントIDだけを変更したM1 unison／M1b filter sweepのビット一致
41. M1 unisonの変更前後におけるRMS差1 dB以内／スペクトル重心差10%以内

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
- 乱数ハッシュの入力には、シェル固有のイベントIDではなく、同じイベント列から再現できる
  startOrderなどの経路非依存な値だけを使う

## M1bで確定した事項

- TPT/ZDF SVFはボイスごとに置き、12 dBモードは1段、24 dBモードは同係数2段直列
- filterCutoffとfilterResonanceは5 msの一次スムーサを通し、create/reset時は目標値へスナップ
- フィルタEGはアンプEGと独立し、アンプEGだけがボイス解放を決める
- LFOはsine／triangle／saw上行／saw下行／square／S&Hの6波形
- LFOはフリーラン時にエンジン共通、リトリガー時にボイス単位で、cutoff／pitch／ampへ直結
- filterEnabled=0かつLFO送り先3つが0ならM0/M1aの既存信号経路を通り、変更前WAVとビット一致
- アンプEGとフィルタEGのディケイ／リリースはcurve 0で従来の指数、curve 1で直線、その間を補間
- curve 0は既存コードパスを維持し、既定プリセットの出力とビット一致
- curve>0はリリース開始時のEG値を保持し、指定した区間長の終端で目標値へ到達

## 未決事項

SPECにないため、以下は公開仕様として確定していません。括弧内は現在の挙動です。

- SYNTH_EV_MACRO の割当先（イベント順序には参加するがM0aでは音声変化なし）
- 未知のイベントkindの扱い（音声変化なし）
- OSC Aが1 unisonかつM1a音源がすべて無効なときのphaseMode=0は、M0aビット互換のため
  0.25 cycle開始を維持する。ユニゾン使用時は経路非依存なstartOrderを使ったhash開始とする
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
- ステレオ化されたボイス信号に対するSVF状態の共有規則
  （現在は左右の定位を保つため、各ボイスの左右チャンネルごとに独立した2段の状態を持つ）
- filterEnabledを発音中にOFF→ONした場合のSVF状態の初期化規則
  （現在はOFF中に状態を更新せず、直前の状態を保持して再開）
- lfoRetriggerを発音中に変更した場合の位相引き継ぎ規則
  （現在は各ボイス位相とエンジン共通位相を常時保持し、変更時点で選ばれた側を使う）
- lfoPhaseを発音中に変更した場合の即時反映規則
  （現在はreset時またはリトリガーnote-on時の開始位置にだけ使う）
- EGのcurveまたは区間時間を区間の途中で変更した場合の進行度引き継ぎ規則
  （現在はcurve>0の経過サンプル数を保持し、現在の区間時間に対する進行度として使う。
  curve 0からcurve>0へ切り替えた場合は、切替時点から進行度0として開始する）
- S&Hのreset／note-on直後、最初のwrap前に保持する値とglobal識別値
  （現在はcycleIndex 0をhashし、globalはvoiceIndex 0xffffffff、layerは32）
- S&HのcycleIndexが2^32を超えた後のhash規則
  （現在はhash入力にcycleIndexの下位32 bitを使う）
- `m1b_filter_sweep` のSPEC未指定値
  （現在はcutoff 200 Hz、filterEgSustain 0、filterEgCurve 0.8）
- `m1b_wobble` のSPEC未指定値
  （現在はcutoff 1000 Hz、resonance 0、sine LFO）
- テスト23〜30でSPECが指定していない測定用パラメータ
  （現在は23/28の−3 dB測定をresonance 0.294415、24をcutoff 1000 Hz・resonance 0、
  25をLP12・cutoff 1000 Hz、26をLP12・cutoff 1000 Hz、27をcutoff 1000 Hz、
  29をLP24・cutoff 200 Hz・sustain 0、30をrate 5 Hzで実行）

## native と wasm の比較（Claude追記 2026-09-04）

```
make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang
node tools/wasm-check/compare.mjs build/synth_engine.wasm presets/m0_saw.txt fixtures/m0_events_chord.txt build/out.wav 48000 128 96000
```
実測: 最大差 −133.6 dBFS、RMS差 −162 dBFS（M0 基準3を満たす）。注意: `synth_reset(ALL)` はパラメータを初期値へ戻すので、プリセット設定後は `reset(VOICES)` を使う。
