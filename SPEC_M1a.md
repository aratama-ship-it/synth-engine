# SPEC M1a — オシレーター部（WT OSC A/B、ユニゾン、B→A の位相変調、サブ、ノイズ）

対象: `apps/music-plugins/synth-engine/core/`（このファイルと同じフォルダの `core/`）。
前提: M0a 完了（`SPEC_M0a.md`）。C ABI は `core/include/synth_engine.h`。テストは `tests/test_main.cpp`、`make test` で走る。

## 絶対条件（変更なし）

- **第三者コードを一切入れない。** ライブラリのコピー・移植も禁止。公知の数式は自分で書き、必要ならコメントに出典URLだけ書く。
- `core/` は標準ライブラリ非依存（`<stdint.h>` `<stddef.h>` のみ）、動的確保なし、例外なし。`make core-freestanding-check` と `make wasm` が通り続けること。
- 音声スレッド（`synth_process`）でアロケーション・ロック・分岐の多い初期化をしない。

## ★最重要の制約：既定値では M0a とビット一致

新規パラメータの既定値は**すべて「無効」側**にする（OSC B レベル 0、サブ 0、ノイズ 0、ユニゾン 1）。
その結果、**既存のテスト1〜8はビット一致のまま PASS しなければならない**。これを壊す変更は不可。

## 1. パラメータ（既存 0〜8 は変更しない。9 以降を追加）

`kParamCount` を 35 にする。`synth_engine_version()` は 2 を返す。範囲外はクランプ、NaN はエラー（-1）を返す既存の挙動を維持する。
int と書いたものは `synth_set_param` で float を受け、内部で丸める（`(uint32_t)(value + 0.5f)` 等）。

| id | 名前 | 範囲 | 既定 | 意味 |
|---|---|---|---|---|
| 9  | oscAUnison | 1..4 int | 1 | OSC A のユニゾン数 |
| 10 | oscADetune | 0..50 | 10 | ユニゾンの最大デチューン（cent） |
| 11 | oscAWidth | 0..1 | 0.5 | ユニゾンのステレオ広がり |
| 12 | oscAOctave | -2..2 int | 0 | オクターブ |
| 13 | oscASemitone | -12..12 int | 0 | 半音 |
| 14 | oscAFine | -100..100 | 0 | 微調整（cent） |
| 15 | oscAPhaseMode | 0..1 int | 0 | 0=ハッシュで散らす／1=固定 |
| 16 | oscAPhase | 0..1 | 0 | phaseMode=1 のときの初期位相 |
| 17 | oscBWavetable | 0..3 int | 0 | OSC B のスロット |
| 18 | oscBMorph | 0..1 | 0 | OSC B のモーフ位置 |
| 19 | oscBLevel | 0..4 | **0** | OSC B の音量（既定 0＝無音） |
| 20 | oscBUnison | 1..4 int | 1 | |
| 21 | oscBDetune | 0..50 | 10 | |
| 22 | oscBWidth | 0..1 | 0.5 | |
| 23 | oscBOctave | -2..2 int | 0 | |
| 24 | oscBSemitone | -12..12 int | 0 | |
| 25 | oscBFine | -100..100 | 0 | |
| 26 | oscBPhaseMode | 0..1 int | 0 | |
| 27 | oscBPhase | 0..1 | 0 | |
| 28 | fmBToA | 0..1 | **0** | B が A を位相変調する深さ |
| 29 | subLevel | 0..4 | **0** | サブオシレーターの音量 |
| 30 | subShape | 0..2 int | 0 | 0=sine, 1=triangle, 2=square |
| 31 | subOctave | -2..0 int | -1 | サブのオクターブ |
| 32 | noiseLevel | 0..4 | **0** | ノイズの音量 |
| 33 | noiseColor | 0..1 int | 0 | 0=white, 1=pink |
| 34 | noiseDecay | 0..60 | 0.05 | ノイズの減衰時定数（秒） |

## 2. 内蔵ウェーブテーブルの変更（slot 0 だけモーフ可能にする）

`initialize_builtin_wavetables` を次に変える。**slot 1〜3 は現状のまま**（1フレーム）。

- **slot 0 = "basic"、4フレーム**: frame0=sine, frame1=triangle, frame2=saw, frame3=square。
  各フレームは既存の `builtin_sample` と同じ加算合成で、ミップ段ごとに帯域制限する。
- slot 1 = saw（1フレーム）、slot 2 = square（1フレーム）、slot 3 = triangle（1フレーム）。**現状と同じ**。
- ★これにより `morph=0` の slot 0 は今までと同じ sine になり、既存テストがビット一致で通る。
- モーフの読み取り: 位置 `morph*(frameCount-1)` の**隣接2フレームを線形補間**する（frameCount==1 なら補間なし）。
  `read_wavetable` は既にモーフ引数を持つので、その中で行う。

## 3. ユニゾン

OSC A/B それぞれ、ユニゾン数 `U`（1..4）ぶんの位相アキュムレータを持つ。`Voice` 構造体を拡張する
（`phase` を `phaseA[4]`, `phaseB[4]` などに。ボイス数16×ユニゾン4×2オシレーター＝128アキュムレータ。固定確保）。

- ユニゾン u（0..U-1）の相対位置 `s(u) = (U==1) ? 0 : (2*u/(U-1) - 1)`（-1..+1）
- **デチューン**: `centsOffset(u) = detune * s(u)`
- **周波数**: `f(u) = baseFreq * 2^((octave*12 + semitone + fine/100 + centsOffset(u)/100) / 12)`
- **初期位相**: `phaseMode==1` なら全ユニゾンが `oscPhase`。`phaseMode==0` なら
  `hash_to_unit(hash32(seed, noteId, voiceIndex, layer))`。`layer` は `oscIndex*8 + u`（A=0, B=1, sub=2, noise=3 を oscIndex とする）。
  ★ハッシュ引数だけで決まるので、発音順に依存しない（既存の決定論方針）。
- **パン**: `pan(u) = width * s(u)`。等電力パン `gainL = cos((pan+1)*π/4)`, `gainR = sin((pan+1)*π/4)`。
- **音量補正**: ユニゾン合計に `1/sqrt(U)` を掛ける。
- **ミップ段**: ユニゾンごとに自分の `f(u)` で `select_mip` する。

## 4. B → A の位相変調（PM。UI 上の名前は FM）

- OSC B の**ユニゾン合成後・レベル適用前**のモノ信号 `bMod`（およそ ±1）を作る。
- OSC A の各ユニゾンは、テーブル読み取り位相を `phaseA(u) + fmBToA * 2.0 * bMod` にする（2.0 = 全開で2サイクル）。
  位相は `[0,1)` に折り返す。**アキュムレータ本体は変調しない**（オフセットとして加えるだけ。ドリフトを防ぐ）。
- OSC B はこれとは独立に `oscBLevel` で出力にも寄与する。純 FM にしたい場合は `oscBLevel=0` にする。
- `fmBToA == 0` のとき、OSC A の出力は M0a と**ビット一致**であること（乗算・加算を挟まない分岐にする）。

## 5. サブオシレーターとノイズ

- **サブ**: ユニゾンなし、1アキュムレータ。周波数 `baseFreq * 2^subOctave`。波形は subShape に応じて内蔵の
  sine / triangle / square を使う（slot 0 frame 0 / slot 3 / slot 2 を読む）。ミップ段は自分の周波数で選ぶ。センター定位。
- **ノイズ**: センター定位。
  - white: `hash_to_unit(hash32(seed, noteId, sampleIndexInVoice, 3)) * 2 - 1`。`sampleIndexInVoice` はノートオンからの経過サンプル数。
    ★これによりブロック分割に依存しない（block不変性テストが通る）。
  - pink: white を3本の1極ローパス（カットオフ 20 Hz / 200 Hz / 2 kHz）に通し、重み 1.0 / 0.32 / 0.10 で足す。
    -3 dB/oct の近似。**この重みは自分で導出した値としてコメントに根拠（各極が10倍間隔で1/√10ずつ寄与）を書く。**
  - 減衰: `noiseEnv = exp(-t / max(noiseDecay, 0.0005))`。1極の乗算再帰で実装（毎サンプル `env *= coef`）。

## 6. 出力の合成

```
monoA = Σ_u tableA(phaseA(u) + fm) * gain   （パンで L/R に分配）
monoB = Σ_u tableB(phaseB(u))        * gain （パンで L/R に分配）
sub   = tableSub(phaseSub)
noise = noiseSample * noiseEnv
L = (A_L*oscALevel + B_L*oscBLevel + sub*subLevel + noise*noiseLevel) * ampEnv * velocity * masterGain
R = (A_R*oscALevel + B_R*oscBLevel + sub*subLevel + noise*noiseLevel) * ampEnv * velocity * masterGain
```
★既定値（B=0, sub=0, noise=0, U=1, fm=0）では L と R がビット一致し、M0a と同一になること。

## 7. テスト（`make test`。既存1〜8に追加し、全項目 PASS）

1〜8: **既存のまま。ビット一致で通ること**（後方互換の証明）。以下を追加する。

9.  **ユニゾン決定論**: unison 4, detune 10, width 0.5 で2回レンダー→ビット一致。seed を変えると出力が変わる。
10. **ユニゾンのラウドネス**: unison 1 と 4 の RMS 差が ±3 dB 以内。
11. **デチューン**: unison 2, detune 50 → 自作FFT（4096点、ハン窓）で2つのピークが 100 ±8 cents 離れている。
12. **パン**: width 1.0, unison 2 で L と R の相関 < 0.99。width 0 で L と R がビット一致。
13. **FM 無効時のビット一致**: fmBToA=0, oscBLevel=0 のとき OSC A 単独出力と完全一致。
14. **FM 有効時の帯域拡大**: fmBToA=1.0 でスペクトル重心が fmBToA=0 の 2倍以上。
15. **FM のエイリアス**: MIDI 72、fmBToA=1.0 の折返し比を測って**数値を出力**（閾値 -30 dB。超えたら FAIL）。
16. **サブ**: subLevel=1, oscALevel=0, subOctave=-1 → FFT の最大ピークが元ノートの 1/2 の周波数（±1%）。
17. **ノイズの減衰と決定論**: noiseLevel=1、他0、noiseDecay=0.05 → 0.5秒時点の RMS が -60 dBFS 以下。同 seed で2回一致。
18. **ピンクノイズの傾き**: noiseColor=1 で 100 Hz〜10 kHz の対数スペクトル傾きが -3.0 ±1.5 dB/oct。
19. **全パラメータのスイープ**: 各パラメータを min / 既定 / max に設定して 0.2秒ずつレンダーし、NaN/Inf 0、|sample| <= 8。
20. **性能**: 16音 × unison 4 × OSC A/B ON × サブ・ノイズ ON で 48 kHz / 128 フレームの1ブロック処理時間の平均と p99 を**数値出力**（閾値なし。記録用）。
21. **block不変性（拡張）**: 上記のフル構成（ユニゾン・FM・サブ・ノイズ全部 ON）で block 1/7/64/128/511 がビット一致。
    ★ノイズがサンプル位置ハッシュで決まるので通るはず。通らなければノイズの実装を直す。

## 8. 付随して更新するもの

- `presets/` に `m1_fm_bell.txt`（fmBToA を使った鐘っぽい設定）と `m1_unison_saw.txt`（unison 4 のノコギリ）を追加する。
  値は仕様の範囲内で妥当に決めてよい（音の良し悪しの判断は本人が後で行う）。
- `README.md` の未決事項に、この仕様で埋めたもの（モーフ補間、ユニゾンのパン則、FM の深さ 2サイクル、ピンクの重み）を
  「M1a で確定」として移す。新たに生じた未決は未決事項へ足す。

## 9. やらないこと

- フィルタ、EG2、LFO、モジュレーションマトリクス、マクロ（M1b 以降）。
- `shells/apple/` と `shells/web/` の変更（AU のパラメータツリー追加は M1 の最後にまとめて行う）。
- ファイルの削除・移動。`Makefile` の構造変更（ソースファイルを増やす場合のみ追記可）。

## 完了条件

- `make test` が全項目 PASS（既存1〜8はビット一致）。`make cli`、`make core-freestanding-check`、
  `make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang` が成功。
- テスト15・18・20 の測定値を報告に含める。
