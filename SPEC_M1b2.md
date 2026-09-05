# SPEC M1b-2 — パラメータ情報をコアから引けるようにし、AU と Web へ公開する

対象: `core/`（C ABI の追加）、`shells/apple/`、`shells/web/`。前提: M1b 完了（パラメータ 0〜52、engine version 3）。

## 背景と狙い

いま**パラメータの定義が3か所に散っている**。

- `core/src/engine.cpp`（範囲の clamp と既定値）
- `shells/apple/SynthEngineAU.mm` の `kParameterDefinitions[]`（**0〜8 しか無い**＝M1a・M1b の追加分が AU から触れない）
- `shells/web/`（プリセット行の解釈のみ）

パラメータを1つ足すたびに3か所を直すのは間違いのもと。**コアを唯一の正本**にして、
殻はコアに問い合わせて自動で組み立てる形にする。

## 1. C ABI の追加（`core/include/synth_engine.h`）

```c
enum SynthParamFlags {
    SYNTH_PARAM_FLAG_NONE      = 0,
    SYNTH_PARAM_FLAG_INTEGER   = 1 << 0,  /* 整数へ丸める */
    SYNTH_PARAM_FLAG_SECONDS   = 1 << 1,
    SYNTH_PARAM_FLAG_HERTZ     = 1 << 2,
    SYNTH_PARAM_FLAG_CENTS     = 1 << 3,
    SYNTH_PARAM_FLAG_SEMITONES = 1 << 4,
    SYNTH_PARAM_FLAG_OCTAVES   = 1 << 5,
    SYNTH_PARAM_FLAG_GAIN      = 1 << 6,  /* 線形ゲイン */
    SYNTH_PARAM_FLAG_BIPOLAR   = 1 << 7   /* 負値を取る */
};

typedef struct {
    uint32_t id;
    const char* identifier;   /* 例 "filterCutoff"。ASCII・空白なし・不変（保存キーに使う） */
    const char* displayName;  /* 例 "Filter Cutoff"。英語 */
    float minimum;
    float maximum;
    float defaultValue;
    uint32_t flags;           /* SynthParamFlags の OR */
} SynthParamInfo;

uint32_t synth_param_count(void);
int      synth_param_info(uint32_t id, SynthParamInfo* out);  /* 0=成功, 負=範囲外 */
```

- 文字列は**静的な定数**（コアは動的確保をしないので、`static const char[]` を指す）。
- `identifier` は**一度決めたら変えない**。AU の状態保存と Web のプリセットのキーになる。
- 実装は `core/src/params.hpp`（新規）に1つのテーブルとして置き、`engine.cpp` の clamp と既定値も
  **このテーブルから引く**ようにする（値の二重管理をなくす）。既存の clamp 挙動・既定値は変えないこと。

## 2. AU（`shells/apple/SynthEngineAU.mm`）

- `kParameterDefinitions[]` を**削除**し、`synth_param_count()` / `synth_param_info()` から
  `AUParameterTree` を組み立てる。`AUParameterAddress` は `id` をそのまま使う。
- 単位のマッピング: INTEGER→`kAudioUnitParameterUnit_Indexed`、SECONDS→`_Seconds`、HERTZ→`_Hertz`、
  CENTS→`_Cents`、SEMITONES→`_RelativeSemiTones`、OCTAVES→`_Octaves`、GAIN→`_LinearGain`、
  それ以外→`_Generic`。
- `fullState` のキーは `identifier`（数値の添字ではなく名前）。**古い状態（数値キー）も読めるように**しておく。
- ファクトリープリセットは `presets/` の内容と合わせて3つ以上（Init／Saw Lead／Filter Sweep／Wobble）。
  **値は `presets/*.txt` から生成したCヘッダ**にする（手で二重に書かない）。生成は `shells/apple/gen_presets.sh`（新規）で、
  `build.sh` から呼ぶ。生成物は `build/` ではなく `shells/apple/generated_presets.h`（コミット対象・再生成可能）。
- **`auval -v aumu Sken Arat` が引き続き警告0で通ること。**

## 3. Web（`shells/web/`）

- `synth-node.js` に `getParams()` を追加し、wasm の `synth_param_count` / `synth_param_info` から
  `[{id, identifier, displayName, min, max, default, flags}]` を返す（文字列は wasm メモリから読む）。
- `demo.html` に**自動生成のパラメータ一覧**を出す（全53項目。折りたたみの中でよい）。
  スライダーで触れるのは「よく使う12個」に絞り、残りは数値表示のみでよい。
  ★スライダーは操作中も音が途切れないこと（値の反映は `setParam` 経由）。
- 既存の「オフライン10秒レンダー」「native との比較」は壊さない。

## 4. テスト

- core: `tests/` に追加。(a) `synth_param_count()==53`、(b) 全 id で `synth_param_info` が成功し
  `identifier` が重複しない・空でない、(c) 各パラメータの `defaultValue` が `min..max` に収まる、
  (d) **`synth_create` 直後の内部値が全パラメータで `defaultValue` と一致**する。
- web: `shells/web/tests/` に `getParams()` の項目数と identifier 重複なしのテストを追加。
- ★既存テスト（M1b までの 34項目）が**すべて PASS のまま**であること。パラメータの意味を変えないこと。

## 完了条件

- `make test` が既存＋新規すべて PASS。`node --test shells/web/tests/` が PASS。
- `bash shells/apple/build.sh` 成功、`auval -v aumu Sken Arat` が警告0で SUCCEEDED。
- `docs_BUILD.md` のパラメータ一覧を「コアのテーブルが正本」と書き換え、`README.md` の構成図に反映。

## やらないこと

- パラメータの追加・削除・意味の変更。UI の作り込み。日本語表示名（英語のみ）。ファイルの削除・移動。
