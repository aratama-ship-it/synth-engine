# SPEC M0a — コア骨格＋CLIレンダラー＋自動テスト（縦切りスパイク第1段）

対象フォルダ: `apps/music-plugins/synth-engine/`（このファイルと同じ場所）。
関連: `PROJECT_NOTES.md`（設計の骨子）、`design/DESIGN_PLAN_2026-09-04.html`（判断用）。

## 絶対条件（ライセンス方針・本人決定 2026-09-04）

- **第三者コードを一切入れない。** ライブラリのコピー・貼り付け・移植も禁止（GPL/AGPL/MIT を問わず）。
  公知の数式・アルゴリズム（SVF、ADSR、ミップマップ加算合成など）を自分で書く。コメントに出典URLを書くのは可。
- **標準ライブラリにも依存しない DSPコア。** `core/` は `<cmath>`・`<vector>`・`<string>`・例外・RTTI・動的確保を使わない。
  必要な数学（sin/cos、exp2、log2、pow2）は `core/src/fast_math.hpp` に自作する（テーブル＋多項式近似。精度要件は下記）。
  理由: のちに **`--target=wasm32 -nostdlib`（Emscripten無し）** でそのままビルドするため。
- CLI・テストは通常のC++20（`<cstdio>` `<vector>` 等は可）。ただしJSONライブラリは使わない（M0aはテキスト行形式で足りる）。

## 作るもの

```
synth-engine/
  core/include/synth_engine.h     C ABI（extern "C"）。安定した公開面
  core/src/*.hpp, *.cpp           実装（fast_math / wavetable / voice / engine / rng）
  tools/render-cli/main.cpp       プリセット＋イベント → WAV
  tests/test_main.cpp             自作アサートのテスト実行体（フレームワーク不使用）
  Makefile                        make core / make cli / make test / make wasm（後者は WASM_CLANG 未設定ならスキップ表示）
  presets/m0_sine.txt, m0_saw.txt
  fixtures/m0_events_*.txt
  build/                          生成物（.gitignore 対象）
```

## C ABI（`synth_engine.h`）

```c
typedef struct SynthEngine SynthEngine;
enum SynthEventKind { SYNTH_EV_NOTE_ON=1, SYNTH_EV_NOTE_OFF=2, SYNTH_EV_PARAM=3, SYNTH_EV_MACRO=4 };
typedef struct { uint32_t offset;    /* ブロック内フレーム 0..nFrames-1 */
                 uint32_t kind;      /* SynthEventKind */
                 uint32_t id;        /* noteId（on/off の対応付け）または paramId/macroIdx */
                 float    a, b;      /* note_on: a=MIDIノート(float、微分音可) b=velocity 0..1 / param: a=値 / macro: a=値 */
               } SynthEvent;
enum SynthResetKind { SYNTH_RESET_VOICES=0, SYNTH_RESET_ALL=1 };

size_t       synth_state_size(void);                       /* 必要バイト数（呼び手が確保。動的確保をコアに持ち込まない） */
SynthEngine* synth_create(void* memory, size_t bytes, double sampleRate, uint32_t maxBlock);
int          synth_set_param(SynthEngine*, uint32_t paramId, float value);   /* 非RT。ブロック境界で反映 */
int          synth_load_wavetable(SynthEngine*, uint32_t slot, const float* frames, uint32_t frameCount); /* 非RT。2048サンプル/フレーム */
void         synth_reset(SynthEngine*, uint32_t kind, uint64_t seed);
int          synth_process(SynthEngine*, const SynthEvent* events, uint32_t nEvents, float* outL, float* outR, uint32_t nFrames);
uint32_t     synth_get_tail_frames(const SynthEngine*);
uint32_t     synth_engine_version(void);                   /* 1 から。互換性判定用 */
```

- 同一 `offset` のイベント順序は **NOTE_OFF → PARAM/MACRO → NOTE_ON** に並べ替えてから処理する（入力順は保証しない）。
- `offset >= nFrames` は無視して戻り値で件数を返す（エラーコードは負、正常は 0 以上）。
- `synth_process` は音声スレッド安全: アロケーション無し、例外無し、ロック無し。

## パラメータID（安定。追加は末尾のみ）

`0 OSC_A_WAVETABLE(slot)`, `1 OSC_A_MORPH(0..1)`, `2 OSC_A_LEVEL`, `3 AMP_ATTACK(s)`, `4 AMP_DECAY(s)`, `5 AMP_SUSTAIN(0..1)`, `6 AMP_RELEASE(s)`, `7 MASTER_GAIN`, `8 VOICE_COUNT_MAX(1..16, 既定16)`。

## DSP仕様（M0aの範囲）

- **ウェーブテーブル**: 2048サンプル/フレーム。読込時に **オクターブごとのミップマップ**（最大10段）を作る。
  M0aの内蔵テーブルは加算合成で生成（`sine`, `saw`, `square`, `triangle`）。各ミップ段は「その段で折り返さない最大倍音数」まで
  加算する（段 k は基音が sampleRate/2 / 2^k 以下の区間で使う想定。倍音数 = floor(1024 / 2^k) を上限）。
  再生は位相アキュムレータ（`double` または 32.32 固定小数）＋線形補間。段の選択は ノート周波数から決める。
- **ボイス**: 16固定。ノートオンで空きボイス、無ければ「リリース中で最も古い」→「最も古い」の順で奪う。
  同一 noteId の重複オンは前を奪う。
- **アンプEG**: ADSR（線形アタック、指数風ディケイ／リリースは1極で可）。リリース後 −96 dB 以下でボイス解放。
- **出力**: ステレオ同一（モノを両chへ）。`MASTER_GAIN` を掛ける。クリップ処理はしない。
- **乱数**: `core/src/rng.hpp` に `uint32_t hash32(seed, eventId, voice, layer)` と `float hash_to_unit(uint32_t)`（明示的な整数→[0,1) 変換）。
  M0aでは未使用でよいが、テストで決定論性（同じ入力→同じ出力）を確認する。
- **fast_math 精度**: sin/cos は 0..2π で最大誤差 1e-4 以下、exp2 は 0..1 で相対誤差 1e-5 以下（テストで検証）。

## CLIレンダラー

`build/render-cli --preset presets/m0_saw.txt --events fixtures/m0_events_chord.txt --out build/out.wav --sr 48000 --block 128 --frames 96000`

- プリセット: 1行1件 `paramId=value`（`#` コメント可）。
- イベント: 1行1件 `frame kind id a b`（`frame` は絶対フレーム。CLIがブロック内オフセットへ変換する）。
- 出力: 32-bit float ステレオ WAV（自作ライタ）。同時に stdout へ `peak_dbfs`、`rms_dbfs`、`nan_count` を出す。

## テスト（`make test` で全部通ること）

1. **ブロック不変性**: 同じプリセット＋イベントを block 1／7／64／128／511 でレンダーし、**ビット一致**。
2. **イベント順序**: 同一 offset で NOTE_ON→NOTE_OFF を逆順で与えても結果が同じ。1,000イベント fixture で欠落 0。
3. **発音位置**: NOTE_ON の offset のフレームから出力が非ゼロになり、その前は 0。
4. **NaN/Inf/denormal**: 96k・44.1k・48k、全 block サイズで NaN/Inf 0。
5. **ポリフォニー**: 20音同時オン → 鳴っているボイスは 16。奪われ方が仕様どおり。
6. **決定論**: reset(seed) → render → reset(同seed) → render が一致。
7. **fast_math 精度**: 上記の閾値。
8. **エイリアス（簡易）**: saw を MIDI 108（C8）で 1秒レンダーし、自作FFT（基数2、2048点）で **基音より上の折返し成分**の比を測り
   −60 dB 以下。閾値は暫定でよいが、測定コードと数値を出す。

## Makefile

- `CXX ?= clang++`、`-std=c++20 -O2 -Wall -Wextra -Werror`。core は `-fno-exceptions -fno-rtti -nostdinc++`
  でもコンパイルできることを `make core-freestanding-check` で確認する（ヘッダ非依存の証明）。
- `make wasm`: `WASM_CLANG`（例 `/opt/homebrew/opt/llvm/bin/clang`）が設定されている時だけ
  `--target=wasm32 -nostdlib -O2 -Wl,--no-entry -Wl,--export-all` で `build/synth_engine.wasm` を作る。未設定なら "skip" と表示して成功終了。
  wasm 用に `memcpy/memset` の自作を `core/src/freestanding_support.cpp` に置く（wasm ビルドのみリンク）。

## 完了条件

- `make test` が全項目 PASS。`make cli` と上記コマンドで WAV が出て `nan_count=0`。
- `make core-freestanding-check` が通る。
- `README.md` にビルド・実行手順（このMacでの例と一般形）を書く。
- 既存ファイル（PROJECT_NOTES.md、design/）は編集しない。ファイルの削除・移動はしない。
