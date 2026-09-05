# SPEC M1b — フィルタ（SVF）＋フィルタ用エンベロープ＋LFO

対象: `core/`（このファイルと同じフォルダの `core/src/`）。前提: M1a 完了（パラメータ 0〜34、engine version 2）。
これは **core だけの作業**。`shells/` と `tools/` は触らない（AU・Web へのパラメータ公開は別仕様 M1b-2 で行う）。

## 絶対条件（M0a から一貫）

- **第三者コードを一切入れない。** ライブラリのコピー・移植も禁止。公知の式を自分で実装する。
- **`core/` は標準ライブラリ非依存**（`stddef.h` / `stdint.h` のみ）、動的確保なし、例外なし、`std::` を使わない。
  数学は `core/src/fast_math.hpp` に足す（`tan` が要る。精度要件は下記）。
- **音声スレッドでアロケーション・分岐の重い処理をしない。**
- ★**後方互換**: 新パラメータはすべて「無効」が既定。`filterEnabled=0` かつ LFO の送り先が全部 0 のとき、
  **既存の出力とビット一致**すること（既存の `legacy_configuration()` の考え方を踏襲・拡張する）。

## 追加パラメータ（35〜52。`kParamCount` は 53 に、`synth_engine_version()` は 3 に）

| id | 名前 | 範囲 | 既定 | 説明 |
|---|---|---|---|---|
| 35 | filterEnabled | 0..1 int | **0** | 0 のとき完全バイパス（信号経路に一切触れない） |
| 36 | filterMode | 0..5 int | 0 | 0=LP12, 1=BP12, 2=HP12, 3=Notch, 4=LP24, 5=HP24 |
| 37 | filterCutoff | 20..20000 | 20000 | カットオフ（Hz） |
| 38 | filterResonance | 0..1 | 0 | 共振。1 付近で自己発振する |
| 39 | filterKeyTrack | 0..1 | 0 | 1 でノートに 1:1 で追従（C4=MIDI 60 を基準） |
| 40 | filterEnvAmount | -8..8 | 0 | フィルタEGの深さ（オクターブ） |
| 41 | filterEgAttack | 0..20 | 0.005 | 秒 |
| 42 | filterEgDecay | 0..20 | 0.2 | 秒 |
| 43 | filterEgSustain | 0..1 | 1 | |
| 44 | filterEgRelease | 0..20 | 0.2 | 秒 |
| 45 | filterVelToEnv | 0..1 | 0 | ベロシティがフィルタEGの深さに効く量 |
| 46 | lfoRate | 0.01..40 | 1 | Hz |
| 47 | lfoShape | 0..5 int | 0 | 0=sine, 1=triangle, 2=saw上行, 3=saw下行, 4=square, 5=S&H |
| 48 | lfoRetrigger | 0..1 int | 0 | 0=フリーラン（エンジン共通）／1=ノートオンで各ボイスがリセット |
| 49 | lfoToCutoff | -8..8 | **0** | LFO→カットオフ（オクターブ） |
| 50 | lfoToPitch | -1200..1200 | **0** | LFO→ピッチ（cent） |
| 51 | lfoToAmp | 0..1 | **0** | LFO→音量（トレモロの深さ） |
| 52 | lfoPhase | 0..1 | 0 | 初期位相（リトリガー時とリセット時の開始位置） |

範囲外は clamp、NaN はエラー（-1）を返す。int 指定のものは最も近い整数へ丸める。既存 0〜34 の意味は変えない。

## フィルタ（TPT/ZDF State Variable Filter）

**1段ぶんの処理（1サンプル）。`g` と `k` はサンプルごとに更新してよい（後述の平滑化のため）:**

```
g  = tan(pi * fc / fs)          fc は下記でクランプ済み
k  = 2 - 1.99 * resonance       resonance 0 → k=2 (Q=0.5) ／ 1 → k=0.01 (自己発振)
a1 = 1 / (1 + g * (g + k))
a2 = g * a1
a3 = g * a2

v3   = input - ic2
v1   = a1 * ic1 + a2 * v3
v2   = ic2 + a2 * ic1 + a3 * v3
ic1  = 2 * v1 - ic1             ← 状態の更新（積分器1）
ic2  = 2 * v2 - ic2             ← 状態の更新（積分器2）

lowpass  = v2
bandpass = v1
highpass = input - k * v1 - v2
notch    = input - k * v1
```

- **モード**: LP12=lowpass, BP12=bandpass, HP12=highpass, Notch=notch。
  **LP24 / HP24 は同じ係数の SVF を2段直列**にする（2段目の入力は1段目の出力）。ボイスごとに2段ぶんの状態を持つ。
- **カットオフの合成**（サンプルごと。`note` はそのボイスのノート番号、`eg2` はフィルタEGの現在値 0..1、`lfo` は -1..1）:

```
cents = 1200 * ( keyTrack * (note - 60) / 12
               + envAmount * (1 - velToEnv + velToEnv * velocity) * eg2
               + lfoToCutoff * lfo )
fc    = cutoffHz * 2^(cents / 1200)
fc    = clamp(fc, 20, 0.45 * fs)        ← ★Nyquist 近傍で tan が発散するので必ずクランプ
```

- ★**平滑化**: `filterCutoff` と `filterResonance` が PARAM イベントで変わったとき、そのままだとジッパーノイズが出る。
  **一次のスムーサ**（時定数 5 ms、`coef = 1 - exp(-1/(0.005*fs))`）を **cutoffHz と resonance の2つに掛ける**。
  ★`synth_reset` と `synth_create` ではスムーサを目標値へ**スナップ**する（ブロック不変性を壊さないため）。
  keyTrack・EG・LFO による変調は平滑化しない（それ自体が連続なので）。
- フィルタは**ボイスごと**に持つ（キートラックとEGがボイス単位のため）。ノートオンで状態（ic1/ic2、2段目も）を 0 にする。
- 入力はそのボイスの全オシレーター合計（OSC A＋B＋サブ＋ノイズ）。**アンプEGを掛ける前**に通す。

## フィルタEG（EG2）

- アンプEGと同じ ADSR の形・同じ実装方針。ボイスごとに独立。ノートオフでリリースへ入る。
- **アンプEGと違い、EG2 が 0 になってもボイスは解放しない**（解放条件はアンプEGのまま）。
- `filterVelToEnv` の効き方は上の式のとおり（0 ならベロシティ無関係、1 ならベロシティに比例）。

## LFO

- 位相は `[0,1)`。1サンプルごとに `rate/fs` 進める。出力は **-1..1**。

| shape | 出力（位相 p） |
|---|---|
| 0 sine | `sin(2*pi*p)` |
| 1 triangle | `p<0.5 ? (4*p - 1) : (3 - 4*p)` |
| 2 saw上行 | `2*p - 1` |
| 3 saw下行 | `1 - 2*p` |
| 4 square | `p<0.5 ? 1 : -1` |
| 5 S&H | 位相が 1 を跨いだ瞬間に新しい値へ更新し、それまで保持 |

- ★**S&H の乱数は消費順に依存させない**。`hash(seed, cycleIndex, voiceIndexOrGlobal, layer=LFO)` から作る
  （`core/src/rng.hpp` の方式に合わせる）。`cycleIndex` は位相が1を跨いだ回数。
  **同じ入力を2回レンダーしたら必ず同じ値**になること。
- `lfoRetrigger=0`: エンジンが1本のフリーラン位相を持ち、全ボイスが共有する。`synth_reset` で `lfoPhase` へ戻す。
- `lfoRetrigger=1`: ボイスごとに位相を持ち、ノートオンで `lfoPhase` から始める。
- **送り先3つ**（M1c のモジュレーションマトリクスが入るまでの直結）:
  - カットオフ: 上のカットオフ式に含む
  - ピッチ: 全オシレーター（A・B・サブ）の周波数へ `2^(lfoToPitch * lfo / 1200)` を掛ける
  - 音量: ボイス出力へ `1 - lfoToAmp * (1 - (0.5 + 0.5*lfo))` を掛ける（深さ0で1倍）

## fast_math への追加

- `tan_pi_normalized(x)`：`tan(pi * x)`、`x` は `0 < x < 0.45`。**最大相対誤差 1e-5 以下**。
  （テーブル＋補間でも多項式でもよい。テストで測る）
- `exp2_fast(x)`：`x` は -14..14。**最大相対誤差 1e-5 以下**。既存の `exp2` を拡張してよい。

## テスト（`tests/test_main.cpp` に 22〜34 を追加。既存21項目は壊さない）

22. **バイパスのビット一致**: `filterEnabled=0`・LFO送り先すべて0 で、`presets/m0_saw.txt` と `presets/m1_unison_saw.txt` の
    出力が**この変更の前とビット一致**（実装前にゴールデンを取ってから作業すること）。
23. **カットオフ精度**: 白色ノイズ入力（noiseLevel を使う）で LP12 の −3 dB 点を測り、
    設定値 200／1000／5000 Hz に対して**誤差 ±5% 以内**。
24. **スロープ**: LP12 は −12 dB/oct、LP24 は −24 dB/oct（カットオフの1〜3オクターブ上で測り、**±3 dB 以内**）。
25. **共振のピーク**: `resonance=0.8` で、カットオフ付近の利得が resonance=0 のときより **+10 dB 以上**。
26. **自己発振の安定**: `resonance=1`・入力なし・10秒。NaN/Inf 0、`|sample| <= 8`。
27. **高速変調の安定**: `lfoRate=40`・`lfoToCutoff=8`・`resonance=0.9`・LP24 で5秒。NaN/Inf 0、`|sample| <= 8`。
28. **キートラック**: `keyTrack=1` で C3 と C4 を鳴らし、−3 dB 点が**2倍±10%**になる。
29. **フィルタEG**: `envAmount=4`・decay 0.3s で、最初の 50 ms と 1 秒後のスペクトル重心を比べ、**最初が2倍以上高い**。
30. **LFO 6種**: 各 shape で1周期ぶんを取り出し、最小 −1・最大 +1（S&H を除く）、周期が `1/rate` と ±1% で一致。
    S&H は同じ入力を2回レンダーして**ビット一致**。
31. **リトリガー**: `lfoRetrigger=1` で同じノートを2回別々に鳴らした波形がビット一致。`0`（フリーラン）では位相が継続している
    （2回目の頭のLFO値が1回目と異なる）ことを確認。
32. **ブロック不変性（フィルタ＋LFO 有効）**: block 1／7／64／128／511 で**ビット一致**。
33. **決定論（全部有効）**: reset→レンダー を2回してビット一致。
34. **性能**: LP24・resonance 0.7・LFO有効・16音×ユニゾン4・48kHz/128 frames で1000ブロック。
    平均と p99 を出力し、**p99 が期限（2667 µs）の 50% 未満**。

## プリセット2つを追加

- `presets/m1b_filter_sweep.txt` — ノコギリ波＋LP24・resonance 0.6・filterEnvAmount 3・decay 0.8s（王道のフィルタスイープ）
- `presets/m1b_wobble.txt` — LFO 5 Hz を LP24 のカットオフへ ±3 オクターブ（うねり）

## 完了条件

- `make test` が **34/34 PASS**。テスト22（バイパスのビット一致）を必ず含むこと。
- `make cli` で上の2プリセットが `nan_count=0` でレンダーできる。
- `make core-freestanding-check` PASS、`make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang` 成功。
- `README.md`（`docs_BUILD.md` ではなく `README.md` の「いまできること」表）と `docs_BUILD.md` のテスト一覧・
  パラメータ一覧・未決事項を更新する。
- 測定値（テスト23〜30の実測数値）を報告する。

## やらないこと

- `shells/` と `tools/` の変更（AU・Web へのパラメータ公開は M1b-2）。フィルタの非線形（ドライブ・飽和）。
  モジュレーションマトリクス（M1c）。M1a に残る位相の扱いのねじれ（M2 で決める）。ファイルの削除・移動。
