# Synth Engine M4n

SPEC_M0a.md の縦切りスパイクに、SPEC_M1a.md のWT OSC A/B、ユニゾン、B→A位相変調、
サブ、ノイズ、SPEC_M1b.mdのTPT/ZDF SVF、フィルタEG、LFO、
SPEC_M1c.mdの6スロット・モジュレーションマトリクスとマクロ2本、および
SPEC_M3a.mdの音符単位パラメータ上書きとセンド出力、SPEC_M4m.mdのMacro 3 / 4とMod EG、
SPEC_M4n.mdの共有Insert FXを追加した実装です。
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

## ゴールデンハッシュと更新手順

ビット一致テストのゴールデンは外部WAVではなく、`tests/test_main.cpp` 内の64-bit
FNV-1a定数です。96,000フレームの左右PCMをL、Rの順にインターリーブし、各`float`の
32-bit表現をlittle-endianの4 byteとしてハッシュします。WAVヘッダは対象に含めません。
テスト41で従来の基準WAVから求めていたRMSとスペクトル重心も同ファイル内の定数です。

`-ffp-contract=off` は必須です。`Makefile`の`CXXFLAGS`と
`shells/apple/build.sh`の4つのC++コンパイル指定から削除しないでください。FMAを許可すると
ネイティブとwasmで丸めが変わり、ゴールデンハッシュも一致しなくなります。

DSPを意図して変更し、ゴールデンを更新する場合は次の順で行います。

1. `-ffp-contract=off`を維持した現在のビルドで`make test`を実行する。
2. 失敗行の`expected=0x...`と`got=0x...`を確認し、対象プリセットとフィクスチャが
   変わっていないことを確認する。
3. 意図した音声変更だけであることを確認してから、該当する`kGolden...Hash`を`got`へ更新する。
4. 変更内容とハッシュ更新をcommitメッセージへ記録し、`make test`、
   `make core-freestanding-check`、`make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang`を再実行する。

## 入力形式

プリセットは1行に paramId=value、イベントは1行に frame kind id a b を書きます。
空行と # 以降は無視します。イベントの frame は絶対フレームで、CLIがブロック内
オフセットへ変換します。

NOTE_ON/OFFの`id`はMIDI音高ではなく、発音インスタンスIDです。NOTE_ONの音高は`a`へ入れ、
対応するNOTE_OFFだけが同じ`id`を使います。異なる`id`の同音は独立した発音として寿命を持ちます。
Webの高水準APIはこのIDを不透明なNoteHandleで管理し、CLIや`sendEvents()`の低水準経路では呼び出し側が
一意なIDを割り当てます。

内蔵wavetableのslotは 0 Basic Shapes、1 Analog Sweep、2 Digital Edge、
3 Hollow Formantです。全slotが4フレームを持ち、morphで隣接フレーム間を移動します。
各slotのmorph 0は従来どおり sine / saw / square / triangleです。
slot 4はセッション用Customです。未読込時は安全なsine 1フレームで初期化し、
`synth_load_wavetable()`で2048 samples × 1〜4 framesを読み込みます。入力は全フレーム検証後に
DC除去・peak 0.95正規化・10段mip生成を行い、無音・NaN・Inf・過大値は既存内容を保持して拒否します。

## パラメータ一覧（engine version 28）

| ID | 名前 | 範囲 | 既定 |
|---:|---|---:|---:|
| 0 | oscAWavetable | 0..4 int | 0 |
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
| 15 | oscAPhaseMode | 0..2 int | 0 |
| 16 | oscAPhase | 0..1 | 0 |
| 17 | oscBWavetable | 0..4 int | 0 |
| 18 | oscBMorph | 0..1 | 0 |
| 19 | oscBLevel | 0..4 | 0 |
| 20 | oscBUnison | 1..4 int | 1 |
| 21 | oscBDetune | 0..50 cent | 10 |
| 22 | oscBWidth | 0..1 | 0.5 |
| 23 | oscBOctave | -2..2 int | 0 |
| 24 | oscBSemitone | -12..12 int | 0 |
| 25 | oscBFine | -100..100 cent | 0 |
| 26 | oscBPhaseMode | 0..2 int | 0 |
| 27 | oscBPhase | 0..1 | 0 |
| 28 | fmBToA | 0..1 | 0 |
| 29 | subLevel | 0..4 | 0 |
| 30 | subShape | 0..2 int | 0 |
| 31 | subOctave | -2..1 int | -1 |
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
| 55 | modSlot0Source | 0..11 int | 0 |
| 56 | modSlot0Dest | 0..15 int | 0 |
| 57 | modSlot0Amount | -1..1 | 0 |
| 58 | modSlot1Source | 0..11 int | 0 |
| 59 | modSlot1Dest | 0..15 int | 0 |
| 60 | modSlot1Amount | -1..1 | 0 |
| 61 | modSlot2Source | 0..11 int | 0 |
| 62 | modSlot2Dest | 0..15 int | 0 |
| 63 | modSlot2Amount | -1..1 | 0 |
| 64 | modSlot3Source | 0..11 int | 0 |
| 65 | modSlot3Dest | 0..15 int | 0 |
| 66 | modSlot3Amount | -1..1 | 0 |
| 67 | modSlot4Source | 0..11 int | 0 |
| 68 | modSlot4Dest | 0..15 int | 0 |
| 69 | modSlot4Amount | -1..1 | 0 |
| 70 | modSlot5Source | 0..11 int | 0 |
| 71 | modSlot5Dest | 0..15 int | 0 |
| 72 | modSlot5Amount | -1..1 | 0 |
| 73 | macro1 | 0..1 | 0 |
| 74 | macro2 | 0..1 | 0 |
| 75 | sendLevel | 0..1 | 0 |
| 76 | oscAWidthCurve | 0..1 int | 0 |
| 77 | oscBWidthCurve | 0..1 int | 0 |
| 78 | fmQuality | 0..1 int | 0 |
| 79 | lfo2Rate | 0.01..40 Hz | 0.25 |
| 80 | lfo2Shape | 0..5 int | 1 |
| 81 | lfo2Retrigger | 0..1 int | 0 |
| 82 | lfo2Phase | 0..1 | 0.25 |
| 83 | macro3 | 0..1 | 0 |
| 84 | macro4 | 0..1 | 0 |
| 85 | modEgAttack | 0..20 s | 0.005 |
| 86 | modEgDecay | 0..20 s | 0.2 |
| 87 | modEgSustain | 0..1 | 0 |
| 88 | modEgRelease | 0..20 s | 0.2 |
| 89 | modEgCurve | 0..1 | 0 |
| 90 | distortionOn | 0..1 int | 0 |
| 91 | distortionDrive | 0..1 | 0.28 |
| 92 | distortionTone | 800..18000 Hz | 12000 |
| 93 | distortionMix | 0..1 | 0.48 |
| 94 | chorusOn | 0..1 int | 0 |
| 95 | chorusRate | 0.05..5 Hz | 0.32 |
| 96 | chorusDepth | 0..1 | 0.45 |
| 97 | chorusWidth | 0..1 | 0.8 |
| 98 | chorusMix | 0..0.65 | 0.32 |
| 99 | eqOn | 0..1 int | 0 |
| 100 | eqLow | -18..18 dB | 0 |
| 101 | eqMid | -18..18 dB | 0 |
| 102 | eqHigh | -18..18 dB | 0 |
| 103 | compressorOn | 0..1 int | 0 |
| 104 | compressorThreshold | -60..0 dB | -18 |
| 105 | compressorRatio | 1..20 | 3 |
| 106 | compressorAttack | 0.001..0.2 s | 0.012 |
| 107 | compressorRelease | 0.03..1 s | 0.22 |
| 108 | compressorMakeup | 0..12 dB | 1 |
| 109 | insertOrder1 | 0..3 int | 0 |
| 110 | insertOrder2 | 0..3 int | 1 |
| 111 | insertOrder3 | 0..3 int | 2 |
| 112 | insertOrder4 | 0..3 int | 3 |
| 113 | voiceMode | 0..2 int | 0 |
| 114 | glideTime | 0..2 s | 0 |
| 115 | oscAUnisonDensity | 0..1.2247449 | 1 |
| 116 | oscBUnisonDensity | 0..1.2247449 | 1 |
| 117 | oscAWarpAmount | -1..1 | 0 |
| 118 | oscBWarpAmount | -1..1 | 0 |
| 119 | oscAWarpMode | 0..2 int | 0 |
| 120 | oscBWarpMode | 0..2 int | 0 |
| 121 | eqLowFrequency | 40..600 Hz | 160 |
| 122 | eqMidFrequency | 200..8000 Hz | 1200 |
| 123 | eqMidQ | 0.25..8 | 0.75 |
| 124 | eqHighFrequency | 1500..18000 Hz | 6800 |

filterModeは0=LP12、1=BP12、2=HP12、3=Notch、4=LP24、5=HP24です。
voiceModeは0=POLY、1=MONO、2=LEGATOです。MONO / LEGATOは最後に押した保持ノートを優先し、離したときは次に新しい保持ノートへ戻ります。MONOはglideTimeが0のときだけ保持中の次ノートで包絡を再アタックし、Glide中は現在の包絡を保って音程だけを移動します。LEGATOはGlide値にかかわらず保持中の包絡を保ちます。glideTimeはこの保持中の遷移を0〜2秒で平滑化し、0では即時です。
oscAUnisonDensity / oscBUnisonDensityは各OSCが4 unisonのときだけ働きます。内側2声を常に残し、外側2声の寄与を0〜`sqrt(1.5)`で左右対称に加え、`1 / sqrt(2 + 2 * density^2)`でエネルギー正規化します。比較UIの`2.0〜5.0 LAYERS`は`2 + 2 * density^2`で表す有効寄与であり、小数個のオシレータを生成する意味ではありません。既定値1の`4.0 FULL`は従来の4声とビット一致し、`5.0 WIDE+`は実声数や処理レイヤーを増やさず外側ペアを約1.225倍へ強めます。unison 1〜3では無効です。
oscAWarpAmount / oscBWarpAmountはOSC A/Bの周期内読出し位相を変形します。0は完全バイパスです。oscAWarpMode / oscBWarpModeは0=BEND、1=ASYM、2=SYNC。BENDの正は中央へ寄せ、負は端へ引きます。ASYMの正は位相を前へ、負は後ろへ傾けます。SYNCは`2^(2 * amount)`の0.25〜4倍でmaster周期内の読出しを伸縮し、master resetの段差をPolyBLEPで補正します。12本の連続操作は5 msで平滑化し、modeはOSCごとのBEND / ASYM / SYNC one-hot weightを同じ5 msで平滑化するため、BENDからSYNCへ切り替える途中にASYMを通りません。各方式の最大読出し速度をmip周波数へ反映します。SubとNoiseには作用しません。
eqLowFrequency / eqHighFrequencyは棚型EQの境界、eqMidFrequency / eqMidQはベル型EQの中心と幅です。3 gainと4つのFrequency / Qは発音中に5 msで平滑化し、idle設定とresetでは目標へ直接合わせます。旧patchに新IDが無い場合はM4awの固定値160 Hz / 1.2 kHz / Q 0.75 / 6.8 kHzを補うため、既存音を維持します。
lfoShapeは0=sine、1=triangle、2=saw上行、3=saw下行、4=square、5=S&Hです。
ampEgCurveとfilterEgCurveは、各EGのディケイ／リリースに共通して作用します。
0は従来の指数カーブ、1は直線、その間は正規化した指数カーブと直線の補間です。
アタックは従来どおり直線です。curve=0は従来の演算経路と終了判定をそのまま使います。
curve>0では進行度を経過サンプル数から求め、ディケイ／リリースの区間長は指定秒ちょうど
（端数がある場合は目標へ到達する最初のサンプル）になります。

モジュレーションのSourceは0=なし、1=LFO 1、2=アンプEG、3=フィルタEG、4=ベロシティ、
5=ノート位置、6=macro1、7=macro2、8=LFO 2、9=macro3、10=macro4、11=Mod EGです。ノート位置は`(midiNote - 60) / 60`を
-1..1へクランプします。Destinationは0=なし、1=Osc A Level、2=Osc B Level、
3=Osc A Morph、4=Osc B Morph、5=FM B→A、6=Sub Level、7=Noise Level、
8=Filter Cutoff、9=Filter Resonance、10=全オシレータPitch、11=Osc A Detune、
12=LFO Rate、13=ボイスAmp、14=OSC A Warp、15=OSC B Warpです。full量は順に4、4、1、1、1、4、4、8 octave、
1、1200 cent、50 cent、8 octave、1、1、1です。

同じDestinationへの寄与は6スロット分を合算してから1回だけクランプします。
Destination 12のLFO 1 Rateだけは全ボイス共通で、ボイス0のSource値を評価した結果を使います。
`SYNTH_EV_MACRO`はid 0〜3をmacro1〜4へ割り当て、`a`を0..1へクランプし、
指定offsetから反映します。未知idは無視件数へ加算します。パラメータ73/74とイベントの
どちらから設定しても5 ms時定数の一次スムーサを通り、macro3/4はパラメータ83/84を使います。
create/reset時は目標値へスナップします。

`SYNTH_EV_VOICE_PARAM`（kind 5）は、`id`でパラメータ、`a`で値を指定し、直後に処理される
NOTE_ONの1音だけへ適用します。同一offsetはまずNOTE_OFF、PARAM/MACROを処理し、その後は
入力配列順に`VOICE_PARAM* → NOTE_ON`の音符バンドルを処理します。複数のVOICE_PARAMは1音へ
まとめて適用でき、NOTE_ONを1つ処理した時点で待機中の全上書きを消費します。NOTE_ONがない
ブロックでは次ブロックへ持ち越します。
値は通常パラメータと同じ範囲へクランプし、NaNまたは許可外IDは適用せず無視件数へ加算します。

上書き許可IDは、1 oscAMorph、2 oscALevel、3 ampAttack、4 ampDecay、5 ampSustain、
6 ampRelease、18 oscBMorph、19 oscBLevel、28 fmBToA、29 subLevel、32 noiseLevel、
34 noiseDecay、36 filterMode、37 filterCutoff、38 filterResonance、40 filterEnvAmount、
41 filterEgAttack、42 filterEgDecay、43 filterEgSustain、44 filterEgRelease、
54 filterEgCurve、75 sendLevelの22個です。上書きされていない値は発音中も毎サンプル
グローバルパラメータを参照するため、グローバル変更が既存ボイスへ効く従来挙動を維持します。

`synth_process_send`はドライの左右出力に加え、`sendL`/`sendR`へセンドを書きます。
各ボイスのフィルタ通過後・アンプEG適用後の信号へsendLevelを掛けて加算し、
マスターゲインは通しません。`synth_process`は両センドポインタをNULLで呼ぶ薄いラッパです。

## WASM

WASM_CLANG が未設定なら成功扱いでskipを表示します。LLVM clangのパスを指定する一般形:

    WASM_CLANG=/path/to/clang make wasm

このMacでHomebrew LLVMを使う場合の例:

    WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang make wasm

## テスト82項目

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
19. 全125パラメータのmin/default/maxスイープ
20. 16音・両OSC 4 unison・サブ・ノイズの処理時間
21. M1a全構成のblock 1/7/64/128/511ビット一致
22. M0 saw／M1 unisonのゴールデンハッシュ一致
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
35. curve=0を明示したM0 saw／M1 unisonのゴールデンハッシュ一致、および125パラメータのメタデータ
36. 直線フィルタEGのディケイ25%／50%／75%時点での実測値
37. curve 0／0.5／1でエンベロープが0.5へ落ちる時刻の単調増加
38. curve、decay、releaseの全80組合せでNaN／Inf、振幅上限、リリース後のボイス解放
39. M0a sawのM1b-3ゴールデンハッシュ一致
40. 同じ演奏のイベントIDだけを変更したM1 unison／M1b filter sweepのビット一致
41. M1 unisonの変更前後におけるRMS差1 dB以内／スペクトル重心差10%以内
42. 全スロット無効時のM0 saw／M1 unison／M1b filter sweepとG4ゴールデンハッシュの一致
43. LFO 1／アンプEG／フィルタEG／ベロシティ／ノート位置／macro1〜4／LFO 2／Mod EGの11信号源
44. 15送り先それぞれのRMS差1 dB以上またはスペクトル重心差5%以上、およびWarp変調の上限clamp
45. Filter Cutoffへ同量を2スロットから送ったときの変化幅が1スロット時の2倍±20%
46. frame 24000のmacroイベント、5 msスムーサ、未知macro idの無視件数
47. 6スロット有効時のblock 1／7／64／128／511ビット一致とreset後の再レンダー一致
48. 6スロット・LP24・LFO・16音×unison 4の平均／p99処理時間と期限判定
49. サブオシレータを+1 octaveにしたときの周波数ピーク
50. M0／M1／M1b／M1cのG6ゴールデンハッシュと、VOICE_PARAMなし・sendLevel 0の出力の一致
51. 2音目だけfilterCutoffを4000 Hzへ上書きしたときのスペクトル重心比
52. 3音目で上書きが残らず、1音目のスペクトル重心へ戻ること
53. 許可外IDとNaNのVOICE_PARAMの無視件数、および16ボイス上限の維持
54. sendLevel 0の完全無音と、0.5時のドライに対するサンプル単位の振幅比
55. 2音目だけsendLevelを上書きしたとき、センドへその音だけが現れること
56. VOICE_PARAMとセンド有効時のblock 1／7／64／128／511ビット一致、ブロック越しの
    待機上書き、およびreset後の再レンダー一致
57. 同一offsetの3バンドル（sendLevel 0／0.5／1）を入力順・逆順とも音ごとに保持すること
58. block末尾のVOICE_PARAMを次block先頭のNOTE_ONだけが消費すること
59. 16音×unison 4・LP24・6スロット・16ボイス上書き時の平均／p99処理時間と期限判定
60. 同じMIDI音高でも異なる発音IDなら個別にNOTE_OFFでき、block 1／7／64／128／511でPCM一致すること
61. 内蔵4 wavetableが各4 frame・全値finiteで、slot 1〜3の終端音色が先頭と十分に異なり、peakが一致すること
62. sawのmip境界直前／直後で、100 cent smoothstep crossfadeがhard switchより20 dB以上段差を減らし、遷移外では既存readerとビット一致すること
63. Morph A/B、Level A/B、Master、FM、Sub、Noise、Density A/B、Warp Amount A/Bの12連続操作と、A/B別Warpの3-way one-hot mode weightが発音中は5 msで平滑化され、idle設定時は目標値へスナップすること
64. unison 1〜4声のdetune／pan配置が左右対称・平均0で、4声時にdetune `-1/-0.2/+0.2/+1`と等間隔panを分離すること
65. Balanced位相が4声を中心へ対称配置し、Natural Widthが端点を保ちながら中間値を広げること
66. FM High Guardが低音の出力を維持し、高音の折返し成分を20 dB以上減らすこと
67. LFO 1 / LFO 2のglobal位相が独立速度で進み、LFO 2のS&H乱数列とノート別retriggerが独立すること
68. Mod EGのADSR、curve、note-off releaseと、Mod EGだけでボイス寿命を延長しないこと
69. 4 Insertそれぞれのfinite出力と変化、順序差、重複／不正順序の既定順フォールバック
70. 4 Insert有効時のblock 1／128一致、reset履歴消去、Chorus 22 msを含むtail frames
71. 6スロット・LP24・16音×unison 4・全Insert有効時の平均／p99処理時間と期限判定
72. Custom slotの安全な初期値、1〜4 frame読込、全mip peak 0.95上限、selector範囲、無音／非有限入力の非破壊拒否
73. 44.1／48／96 kHzでC8 wavetableとHQ FMの高域安全性、低sample rateでの折返し低減
74. Filter ON/BYPASSの5 msクロスフェード、static ON、reset時の状態消去、有限出力
75. AMP / FILTER SustainとFILTER ENV AMOUNTの保持中5 ms平滑化、新規noteへの直接反映
76. 6 Filter modeの5 ms one-hot補間、発音中の高速切替とMatrix併用時の有限出力
77. POLYの既存同時発音、MONOの最新保持音・指戻し・release、Glide中の包絡保持、Glide 0の再アタック、LEGATOの包絡保持、Glideの有限な収束
78. 4 unison densityの左右対称、2.0〜5.0のエネルギー正規化、外側ペアの単調な追加、既定4.0の従来4声との一致、1〜3声への非干渉、WIDE+のside/mid増加とモノ合成レベル差
79. OSC Bend Warpの単調な位相写像、0／0.5／1の基準点、OFF完全一致、BEND -／+のPCM差、alias-aware mipによる折返し低減
80. OSC ASYM WarpとBEND間補間の単調性、端点固定、導関数範囲、正負／BENDとの差、既定BENDのビット一致、alias-aware mipによる折返し低減
81. OSC SYNC Warpの0.25〜4倍ratio、Amount 0／既定patchのビット一致、正負のPCM差、PolyBLEPによるnaive hard sync比の折返し低減、全mode遷移のone-hot和と非対象mode非混入
82. 3-band EQのneutral完全一致、各帯域の応答と漏れ、Frequency / Q可変時の中心移動・幅、5 ms平滑化、高速操作時の有限出力とrelease後無音

エイリアス測定は4-term Blackman-Harris窓を使い、基音電力に対する「基音より上、かつ
期待される第1〜4倍音の各±10 binを除いた電力」の比です。MIDI 108では選択される
mipの倍音上限が4のため、この4倍音を期待成分とします。

## M1aで確定した事項

- wavetableは4 slot、1 slotあたり最大4 frame
- morphは隣接2フレームの線形補間
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

## M1cで確定した事項

- モジュレーションマトリクスは6スロット固定で、7信号源と13送り先を持つ
- 単極性／双極性のSource値は変換せず、`source * amount * full`を送り先へ加算する
- 同じ送り先の全寄与を合算した後に1回だけクランプする
- 評価はサンプルごと・ボイスごと。LFO Rateだけはボイス0の評価を全ボイスで共有する
- マクロ2本はパラメータ73/74または`SYNTH_EV_MACRO` id 0/1から設定し、5 msで平滑化する
- 全スロット無効時は既存M0／M1a／M1bの信号経路を維持し、G4ゴールデンハッシュと一致する

## M3aで確定した事項

- ボイス上書きは固定長22値と32-bitマスクで保持し、動的確保を使わない
- VOICE_PARAMなし・sendLevel 0では既存のドライ信号経路を維持し、G6ゴールデンハッシュと一致する
- センドはボイスのフィルタ後・アンプEG後から分岐し、マスターゲインを通さない
- `synth_process`のシグネチャは維持し、`synth_process_send`へセンドNULLで委譲する

## M3c-2で確定した事項

- 同一offsetの`VOICE_PARAM* → NOTE_ON`は入力配列の順序を意味として保持する
- 同時発音ごとの設定は正規APIの`noteOnWith()`で音符バンドルとして送る
- `SynthEvent`の20 byte ABIとイベントkindは維持し、同時発音の意味変更に伴いengine versionは8とする

## M3c-3で確定した事項

- NOTE_ON/OFFの`id`は、MIDI音高ではなく32-bitの発音インスタンスIDである
- Webの`noteOn()`／`noteOnWith()`は不透明なNoteHandleを返し、`noteOff(handle)`でだけ対応する発音を終了する
- 数値MIDIを`noteOff()`へ渡す旧形式、別Nodeのhandle、ID再利用は拒否する
- C ABIの20 byte `SynthEvent`、DSP、engine version 8は変更しない

## M4aで確定した事項

- 内蔵4 slotはすべて4 frameとし、Basic Shapes / Analog Sweep / Digital Edge / Hollow Formantとして公開する
- 各slotのframe 0は従来のsine / saw / square / triangle生成式を維持する
- slot 1〜3の追加frameは高調波係数から非RT初期化時に生成し、frame 0とpeakを揃える
- C ABIとパラメータ76個は維持する。OSC A/Bのslot selectorはともに整数とし、内蔵wavetableの意味変更に伴いengine versionは9とする

## M4fで確定した事項

- 周波数から選んだalias-safeなprimary mipが安全になった境界から100 centだけ、次の制限mipからprimaryへsmoothstepでクロスフェードする
- richer mipは全倍音がNyquist内へ入るまで読まない。遷移外はprimary mipを1回だけ読み、従来出力とビット一致する
- Osc A / Osc B / B→A位相変調源 / Subの全render pathへ同じreaderを使う
- C ABIとパラメータ76個は維持し、PCM意味変更に伴いengine versionは10とする

## M4gで確定した事項

- Osc A/B Morph、Osc A/B Level、B→A FM、Sub Level、Noise Level、Master Gainのグローバル操作値は5 msの一次スムーサを通す
- idle時のパラメータ設定とcreate/resetでは目標値へスナップし、プリセット読込後の初音に不要な立ち上がりを作らない
- ノート単位のVOICE_PARAM上書きは即時値を使い、Matrix/LFOの寄与は平滑化後のbaseへ加算して意図した変調速度を維持する
- unisonのpanは等間隔、detuneは4声時だけ`-1/-0.2/+0.2/+1`とし、外側の広がりと内側の音程の芯を分担する
- 合計ゲインは従来どおり`1/sqrt(U)`、panは等電力とする。C ABIとパラメータ76個は維持し、engine versionは11とする

## M4hで確定した事項

- Osc A/BのPhase ModeへBalancedを追加し、4声を中心位相の周囲へ対称配置する
- Osc A/BのWidth CurveはLinear / Naturalを独立選択し、Naturalは0%と100%の端点を維持する
- FM QualityはLegacy / HQ Guardを選択し、HQ Guardは高音域だけFM depthを連続的に抑える
- 既存IDは維持し、パラメータ76〜78を末尾追加する。engine versionは12とする

## M4lで確定した事項

- LFO 2はLFO 1と独立したrate / shape / retrigger / phaseと、別のS&Hハッシュ層を持つ
- LFO 2は既存6-slot MatrixのSource 8として追加し、LFO 1のcutoff / pitch / amp直結経路は複製しない
- LFO 1 / LFO 2はfree-run時に別々のengine共通位相、retrigger時に別々のvoice位相を使う
- 既存IDとC ABIは維持し、パラメータ79〜82を末尾追加する。engine versionは13とする
- LFO 2を使わない全18プリセットはnative / WASMでサンプル単位のビット一致を維持する

## M4mで確定した事項

- Macro 3 / 4は既存Macroと同じ5 ms一次スムーサを通り、`SYNTH_EV_MACRO` id 2/3からも操作できる
- Mod EGはアンプ／フィルタEGと独立したADSR / Curveを持ち、既存MatrixのSource 11としてだけ接続する
- Matrix Sourceは既存番号を維持したままMacro 3=9、Macro 4=10、Mod EG=11を末尾追加する
- 既存IDとC ABIは維持し、パラメータ83〜89を末尾追加する。engine versionは14とする

## M4nで確定した事項

- Distortion / Chorus / 3-band EQ / Compressorは共有C++コアで処理し、WebとAUが同じパラメータ／順序を使う
- Delay / ReverbはWeb専用の軽い後段空間系として維持し、共有コアには含めない
- 4 Insertは初期BYPASSで既存ゴールデンをビット一致させ、wet／bypassを平滑化する
- 順序指定に重複または範囲外があればDistortion → Chorus → EQ → Compressorへフォールバックする
- 既存IDとC ABIは維持し、パラメータ90〜112を末尾追加する。engine versionは15とする
- Chorus有効時は最大22 msを`synth_get_tail_frames`へ追加する

## M4akで確定した事項

- 通常の`VOICES`と各OSCの`UNISON`は整数の発音数として維持し、小数の意味を混ぜない
- 4声時だけ、内側2声を芯として外側2声の寄与を左右対称に連続追加するA/B別densityを持つ
- 表示上の有効寄与は`2 + 2 * density^2`の2.0〜4.0 layersであり、実際の発音レイヤー数と最大同時発音数は整数のまま
- 合計振幅は`1 / sqrt(2 + 2 * density^2)`で正規化し、音量の急増と定位中心の移動を避ける
- densityは既存の5 ms制御スムーサを通し、初期値1では従来4声とビット一致、unison 1〜3では無効とする
- パラメータ115 / 116を末尾追加し、engine versionは23とする。通常画面には出さず`?quality=1`の比較UIだけでA/Bを連動操作する

## M4alで確定した事項

- 比較UIを連続rangeから`2.0 FOCUS / 3.0 BALANCED / 4.0 FULL / 5.0 WIDE+`の4段切り替えへ変更する
- `4.0 FULL`を既定値1として維持し、従来の4声PCMと完全一致させる
- density上限を`sqrt(1.5)`へ広げ、WIDE+は実声数・pan位置・CPU上の処理レイヤーを増やさず外側ペアのraw gainだけを約22.5%強める
- 5 ms平滑化とエネルギー正規化を拡張範囲でも維持し、発音中の切り替えでnote resetや再アタックを起こさない
- パラメータ数117とC ABIは維持し、opt-inのPCM意味追加によりengine versionは24とする

## M4amで確定した事項

- 末尾ID 117 / 118へA/B別のBend Warp量`-1..1`を追加し、既定値0は旧PCMと完全一致させる
- 位相写像は`p + 0.85 * amount * sin(2*pi*p) / (2*pi)`とし、導関数0.15..1.85の単調変形に限定する
- 最大局所速度`1 + 0.85 * abs(amount)`をwavetable mip選択へ反映し、高域の折返しを保守的に抑える
- AはFM後の読出し位相、Bは可聴信号とB→A変調源の両方をwarpし、Sub / Noiseは変更しない
- A/B値は5 ms平滑化し、通常画面には出さず`?quality=1`の`BEND - / OFF / BEND +`だけで連動比較する
- パラメータ数119、engine version 25。C ABIとイベント形式は変更しない

## M4anで確定した事項

- M4amのA/B別Bend Warpを、通常OSC A／Bカードの波形直下へ`OFF / BEND` modeと符号付き`AMOUNT`として表示する
- modeは現在のAmountから導出し、0はOFF、非0はBENDとする。mode専用のコア値や保存状態は増やさない
- OFFからBENDへ戻すと各OSCで最後に使った非0値を復元し、未使用時は比較値`+0.75`を使う
- A/B独立操作とQuality LabのA/B連動比較を双方向に表示同期する
- UI操作はnote停止、voice reset、自動発音、AudioContext開始を行わず、M4amの5 ms平滑化をそのまま使う
- DSP、パラメータ数119、engine version 25、C ABI、パッチ形式は変更しない

## M4aoで確定した事項

- Matrix destination 14 / 15へ`OSC A Warp` / `OSC B Warp`を末尾追加し、既存0〜13の番号は維持する
- 6つのdestination parameter ID 56 / 59 / 62 / 65 / 68 / 71の範囲を`0..15`へ広げる
- full-scaleは1.0。A/Bとも`base + source * amount`を合算後に`-1..1`へclampし、その実効値をphase warpとalias-aware mipへ使う
- Bの可聴信号とB→A FM sourceには同じ実効Warpを使い、Sub / Noiseは変更しない
- 通常OSCの各Amountへ既存形式の`+ MOD`を追加し、Matrix行と同じ6 slotを編集する
- パラメータ数119、C ABI、イベント形式、patch schemaは維持し、opt-in PCM経路追加としてengine versionを26へ更新する

## M4apで確定した事項

- 末尾ID 119 / 120へA/B別Warp modeを追加し、0=BEND、1=ASYM、既定0とする
- ASYMは`p + 0.85 * amount * p * (1 - p)`で周期端を固定し、導関数0.15..1.85の単調変形に限定する
- BENDとASYMの切替中は二つの写像を既存control smootherと同じ5 msで補間し、note reset／再アタックを起こさない
- Amount 0はmodeにかかわらず既存PCMと完全一致し、mip保護は既存の最大局所速度`1 + 0.85 * abs(amount)`を共有する
- 通常OSCの既存selectへ`ASYM`だけを加え、A/B別mode、波形、状態文、パッチ保存を同期する。Quality Labの固定3比較はBEND専用のまま維持する
- パラメータ数121、C ABI、イベント形式、patch schema 1は維持し、opt-in PCM追加としてengine versionを27へ更新する

## M4aqで確定した事項

- ID 119 / 120の範囲を`0..2`へ広げ、2=`SYNC`を追加する。既定0、既存BEND / ASYM、パラメータ数121、C ABI、イベント形式、patch schema 1は維持する
- SYNC ratioは`2^(2 * amount)`の0.25〜4倍とし、読出し位相は`fract(masterPhase * ratio)`、Amount 0は既存PCMを直接通す
- master周期resetだけをPolyBLEP補正し、mipは`frequency * max(1, ratio)`で選ぶ
- mode切替は連続値0→1→2ではなく、OSCごとのBEND / ASYM / SYNC one-hot weightを5 ms補間する。BEND↔SYNC間にASYMを混入させない
- 通常OSCの既存selectを`OFF / BEND / ASYM / SYNC`へ拡張し、符号、stretch / compress、ratioを状態文と波形のアクセシブル名へ出す
- engine versionを28へ更新する。SYNCの音楽的な硬さと有用なAmount範囲は低音量の本人試聴へ残す

## M4arで確定した事項

- 他社presetの同一音再生は主張せず、確認できた数値だけを既存schema 1 patchへ変換し、`mapped / approximate / unsupported`をreportへ分ける
- 最初の実動対象はSerum 2 `.SerumPreset`。`XferJson` header、JSON metadata、Zstandard圧縮CBOR payloadを上限付きでdecodeするローカルCLIを`tools/serum2-preset-bridge.mjs`へ置く
- 他社wavetable / sample資産、展開payload、factory presetをrepoへ複製せず、元presetはread-onlyで扱う
- 原本と同じ出力先、patch / reportの重複、既存ファイルへの暗黙の上書きを拒否する
- Serum 1 `.fxp`、Massive `.nmsv`、Avengerは実sampleと内部形式を確認できるまで未対応と表示する
- ブラウザ直読みはまだ行わず、Patch Toolsの`PRESET BRIDGE`から判断用HTMLへ進み、CLI出力を既存`IMPORT JSON`で読む

## M4atで確定した事項

- Serum 2 modulationはENV 1〜3 / Macro 1〜4のlinearな単一source routeだけを、`ModSlot0..63`の順に既存6-slot Matrixへ最大6件近似する
- Aux source、bypass、bipolar、curve、LFO、未知source / destination、6件超過は適用せず、report version 2の`modulation.skipped`へroute別の理由を残す
- 変換されたENV 2 / ENV 3だけ対応するADSRを、使用されたMacro 1〜4だけ現在値を復元する。patch schema、DSP、engine version、通常UIは変更しない
- 低音量試聴patchは引き続きMASTER 0.20以下、Delay / Reverb OFF、Insert OFFとし、物理出力未接続WASMで有限値・peak 0.25以下・release / panic後無音を検証する
- 判断ページの`SERUM ORIGINAL`は、`tools/serve.mjs`のlocalhost限定・固定3件allowlistからインストール済み原本を`.SerumPreset`名でread-only streamする。任意パスを受けず、workspace／公開buildへ原本を複製しない。変換後の`SYNTHENGINE JSON`とは別の入口にする

## M4auで確定した事項

- Preset Bridgeの固定3候補へ`SYNTHENGINEで開く`を追加し、候補IDから固定したschema 1 JSONを既存validatorへ通して通常Synthへ一手で読み込む
- 起動入力は`bridgePreset=pianofy|morpheus|neon-drive`だけを許可し、任意URL、filesystem path、JSON本文は受けない。未知ID、取得失敗、validation失敗ではEPianoを保持する
- 明示した候補はautosaveより優先する。成功後は一度だけ使う`bridgePreset`をURL履歴から除き、通常のautosave規約へ戻す
- 読み込み時にAudioContextのresume、note-on、output gate openを行わない。既存どおり鍵盤またはPCキーの明示操作まで出力をミュートする
- `SERUM ORIGINAL / JSON保存 / MAPPING`は補助導線として保持し、他社音源との完全互換や音色一致は主張しない

## M4avで確定した事項

- Serum 2実画面とPianofy payloadの照合により、modulation source IDを`2 = ENV 1`、`3 = ENV 2`、`4 = ENV 3`、`5 = ENV 4`、`6 = LFO 1`、`17 = Note#`へ訂正する
- `Oscillator module 3 / kParamVolume`をNoise Levelへ近似し、PianofyのENV 2でNoiseの短い発音層を開ける。Sub、OSC C、bipolar Note#、LFO curve / modeはまだ移さない
- 有効VoiceFilterのDriveと、modeを明示できるTape Satだけを既存Distortionへまとめる。安全試聴profileはDrive 0.24以下、Mix 0.20以下、MASTER 0.20以下、Delay / Reverb OFFとする
- FatはPianofyのdecoded plainParamsに値がなく、推測で補完しない。その他のFX algorithm、routing、curveもreport-onlyとする
- report version 3へFX近似値と上限を追加し、旧候補を上書きせず`audition-mod-fx-v2/`へ出力する。patch schema、DSP、engine versionは変更しない

## 未決事項

SPECにないため、以下は公開仕様として確定していません。括弧内は現在の挙動です。

- 未知のイベントkindの扱い（音声変化なし）
- 同じパラメータIDのVOICE_PARAMを1つのNOTE_ON前に複数受けた場合の優先規則
  （現在は処理順で最後の値を使う）
- reset時の待機中VOICE_PARAMの保持規則
  （現在はSYNTH_RESET_VOICESとSYNTH_RESET_ALLのどちらでも待機中上書きを消去する）
- ボイス上書きしたfilterCutoff/filterResonanceのスムージング規則
  （現在は上書き値を直接使い、未上書き時だけ従来のグローバル5 msスムーサを使う）
- `synth_process_send`でsendL/sendRの片方だけがNULLの場合の扱い
  （現在は非NULL側だけを書き、NULL側を破棄する）
- sendLevelのパラメータflags（現在はゲイン量として`SYNTH_PARAM_FLAG_GAIN`を付ける）
- ボイス上書きしたampReleaseと`synth_get_tail_frames`の関係
  （現在はグローバルampReleaseに、Chorus有効時だけ最大22 msを加えてtail framesを返す）
- OSC Aが1 unisonかつM1a音源がすべて無効なときのphaseMode=0は、M0aビット互換のため
  0.25 cycle開始を維持する。ユニゾン使用時は経路非依存なstartOrderを使ったhash開始とする
- 発音中にunison数、phaseMode、固定phaseを変更した場合の位相再初期化規則
  （現在は再初期化せず、ノートオン時に用意した各位相を継続）
- 発音中にnoiseLevelを0から上げた場合のpink LPF履歴
  （現在はnoiseLevel=0の間はLPFを更新しない）
- ノイズのsampleIndexが2^32 sampleを越えた後のhash規則
  （現在はhash入力の下位32 bitを使う）
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
- lfoRetrigger有効中にボイス0が非アクティブな場合のLFO Rate送り先の評価規則
  （現在はclear後のボイス0 LFO値を使い、ボイス依存Sourceは0として評価する）
- マクロの一次スムーサにおける「5 ms」の厳密な到達判定
  （現在は既存カットオフと同じ5 ms時定数で、5 ms後に目標差の約63.2%を消化する）
- `m1b_filter_sweep` のSPEC未指定値
  （現在はcutoff 200 Hz、filterEgSustain 0、filterEgCurve 0.8）
- `m1b_wobble` のSPEC未指定値
  （現在はcutoff 1000 Hz、resonance 0、sine LFO）
- テスト23〜30でSPECが指定していない測定用パラメータ
  （現在は23/28の−3 dB測定をresonance 0.294415、24をcutoff 1000 Hz・resonance 0、
  25をLP12・cutoff 1000 Hz、26をLP12・cutoff 1000 Hz、27をcutoff 1000 Hz、
  29をLP24・cutoff 200 Hz・sustain 0、30をrate 5 Hzで実行）
- テスト43〜48でSPECが指定していない測定用パラメータ
  （現在は固定位相の内蔵波形を基準にし、44は送り先ごとに発音源とLFO初期位相を設定、
  45はwhite noise・LP24・cutoff 1000 Hz・amount 0.0625、46はmacro1→Osc A Level、
  48はmacro1=0.5・macro2=0.25で実行）

## native と wasm の比較（Claude追記 2026-09-04）

```
make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang
node tools/wasm-check/compare.mjs build/synth_engine.wasm presets/m0_saw.txt fixtures/m0_events_chord.txt build/out.wav 48000 128 96000
```
実測: 最大差 −133.6 dBFS、RMS差 −162 dBFS（M0 基準3を満たす）。注意: `synth_reset(ALL)` はパラメータを初期値へ戻すので、プリセット設定後は `reset(VOICES)` を使う。

## M4aw EQ quality pass（2026-09-09）

- 既存ID 99〜102と`LOW / MID / HIGH` UIを維持し、EQ内部を一次band splitから160 Hz low shelf／1.2 kHz Q 0.75 bell／6.8 kHz high shelfの直列biquadへ変更した。
- 発音中の3 gainは既存と同じ5 ms時定数で平滑化する。無発音時の設定とreset時は目標へ直接合わせる。
- EQ BYPASSとEQ ON・全gain 0 dBは旧PCMとビット一致。parameter count 121、patch schema 1、event ABIは不変で、enabled-EQ PCM変更によりengine versionは29。
- core 82/82、Web 84/84、freestanding、WASM、全Insert有効時のnative/WASMビット一致、Apple arm64 compile-onlyを検証した。帯域応答の測定値と無出力安全ゲートは`SPEC_M4aw.md`と`PROJECT_NOTES.md`に記録する。

## M4ax Parametric EQ controls / response（2026-09-10）

- M4awの3 gainと旧patch音を維持し、末尾ID 121〜124へLow Frequency、Mid Frequency / Q、High Frequencyを追加した。parameter countは125、patch schema 1とevent ABIは維持し、engine versionを30へ更新した。
- 4つの新操作も発音中は5 msで平滑化する。Webの`FILTER RESPONSE`はコアと同じRBJ係数と直列順序から160点を算出し、20 Hz〜20 kHz対数／−24〜+24 dB固定軸で表示する。
- core 82/82、Web 79/79、freestanding、WASM、可変EQを含むnative/WASMビット一致、Apple arm64 compile-onlyを検証した。無出力WASM安全ゲートはFrequency / Q / Gainの両端切替を44.1／48／96 kHzで行い、最大peak 0.187265以下、release後3.92e-15以下、panic後0、NaN / Inf 0だった。
- 390×844／1440×900のFX面はdesign-lintでNG 0／WARN 0／測定不可0、44px未満0件、最悪コントラスト8.10:1。物理出力、音楽的な帯域幅、Safari／実機タッチは本人確認待ち。仕様は`SPEC_M4ax.md`。
