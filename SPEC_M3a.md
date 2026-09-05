# SPEC M3a — 音符ごとのパラメータ上書きと、センド出力

対象: `core/` のみ（`shells/` の対応は M3b で行う）。前提: M2 完了（パラメータ 0〜74、engine version 6）。

## なぜ作るか

random-scale-keys は「音符ごとに専用の音声グラフを組む」設計で、**キーごとに違う効果**を持たせている。

- `sweep`（3キー）: **その音だけ**フィルタが 400→4000 Hz へ開く
- `delay`（4キー）: **その音だけ**ディレイバスへ送る

一方 synth-engine はパラメータが16声で共有なので「その音だけ」を作れない。
インスタンスを音色×効果の数だけ立てれば回避できるが（最大12本・約15MB）、構成として素直でない。
**音符ごとのパラメータ上書き**と**センド出力**をコアに入れれば、**インスタンス1本で今の挙動を完全再現できる。**
どちらも汎用シンセとして正当な機能で、AU/スタンドアロンでも「音符ごとに表情をつける」用途に使える（MPE的）。

## 1. 音符ごとのパラメータ上書き（`SYNTH_EV_VOICE_PARAM`）

```c
enum SynthEventKind {
    SYNTH_EV_NOTE_ON = 1, SYNTH_EV_NOTE_OFF = 2, SYNTH_EV_PARAM = 3, SYNTH_EV_MACRO = 4,
    SYNTH_EV_VOICE_PARAM = 5   /* 追加 */
};
```

- `event.id` = パラメータID、`event.a` = 値。**次に処理される NOTE_ON にだけ効く。**
- 同一 offset での処理順は **NOTE_OFF → PARAM/MACRO → VOICE_PARAM → NOTE_ON**（VOICE_PARAM を NOTE_ON の直前に置く）。
- 複数の VOICE_PARAM を並べれば、まとめて1つのノートに適用できる。
- **NOTE_ON が1つ処理されたら、待機中の上書きはすべてクリアされる**（次のノートには持ち越さない）。
- NOTE_ON が来ないまま `synth_process` が終わった場合、待機中の上書きは**次のブロックへ持ち越す**
  （イベントがブロック境界をまたいでも壊れないようにするため）。
- 値は通常の `synth_set_param` と同じ範囲で clamp する。NaN は無視し、無視件数に計上する。

### 上書きできるパラメータ（許可リスト）

ボイス単位で意味を持つものだけを許可する。**それ以外のIDが来たら無視し、無視件数に計上する。**

`1 oscAMorph` / `2 oscALevel` / `3 ampAttack` / `4 ampDecay` / `5 ampSustain` / `6 ampRelease` /
`18 oscBMorph` / `19 oscBLevel` / `28 fmBToA` / `29 subLevel` / `32 noiseLevel` / `34 noiseDecay` /
`36 filterMode` / `37 filterCutoff` / `38 filterResonance` / `40 filterEnvAmount` /
`41 filterEgAttack` / `42 filterEgDecay` / `43 filterEgSustain` / `44 filterEgRelease` /
`54 filterEgCurve` / `75 sendLevel`（下記で追加）
（22個。ボイスは 32bit のマスクで「どれが上書きされているか」を持てばよい）

### 実装方針

- `Voice` に上書き値の配列とマスクを持たせる。**動的確保はしない**（固定長）。
- レンダー時のパラメータ参照を `voice_param(engine, voice, <許可リスト内の添字>)` に通す。
  マスクが立っていればボイスの値、立っていなければ `engine->params[...]`。
- ★**グローバルなパラメータ変更が発音中のボイスに効く現行の挙動は変えない**
  （上書きされていないパラメータは、これまでどおりグローバル値を毎サンプル読む）。

## 2. センド出力

```c
/* 既存。sends を捨てるだけの薄いラッパにする */
int synth_process(SynthEngine*, const SynthEvent*, uint32_t, float* outL, float* outR, uint32_t nFrames);

/* 追加。sendL/sendR に NULL を渡したら synth_process と同じ */
int synth_process_send(SynthEngine*, const SynthEvent*, uint32_t,
                       float* outL, float* outR, float* sendL, float* sendR, uint32_t nFrames);
```

- 新パラメータ **`75 sendLevel`（0..1、既定 0）**。`kParamCount` は 76、`synth_engine_version()` は 7。
- 各ボイスの出力（**ドライと同じ地点＝フィルタ通過後・アンプEG適用後**）に `sendLevel` を掛けたものを
  センドバスへ加算する。ボイスごとの上書きが効く。
- センドは**マスターゲインを通さない**（送り先で処理するため）。ドライ側の挙動は一切変えない。

## 3. 後方互換（最重要）

- `SYNTH_EV_VOICE_PARAM` を使わず `sendLevel` が 0 のとき、**既存の出力とビット一致**すること。
  基準: `presets/m0_saw.txt` `m1_unison_saw.txt` `m1b_filter_sweep.txt` `m1c_macro_morph.txt` ×
  `fixtures/m0_events_chord.txt`（48000Hz block128 96000frames）。実装前にゴールデンを取ること。
- 既存49テストはすべて PASS のまま。

## テスト（50〜56 を追加）

50. **バイパスのビット一致**: 上記4プリセットが変更前とビット一致。
51. **音符ごとの上書きが効く**: 同じプリセットで2音を順に鳴らし、2音目の直前に
    `VOICE_PARAM(37 filterCutoff, 4000)` を置く。**2音目だけスペクトル重心が高い**（1音目比 1.5倍以上）。
52. **持ち越さない**: 上の直後にもう1音鳴らし、**3音目は1音目と同じ明るさに戻る**（重心差 10% 以内）。
53. **許可リスト外は無視**: `VOICE_PARAM(8 voiceCountMax, 1)` を送っても発音数が変わらず、
    戻り値の無視件数が 1 増える。
54. **センド出力**: `sendLevel=0` でセンドが完全な無音。`sendLevel=0.5` でセンドの振幅がドライの
    ちょうど 0.5 倍（サンプル単位で `|send - dry*0.5| < 1e-6`）。
55. **音符ごとのセンド**: 2音のうち片方だけ `VOICE_PARAM(75 sendLevel, 1)` を付け、
    **センドにはその1音だけが現れる**（もう片方の発音区間でセンドが無音）。
56. **決定論とブロック不変性**: VOICE_PARAM とセンドを使った状態で block 1／7／64／128／511 でビット一致、
    reset→レンダー2回でビット一致。
57. **性能**: 上書きを使った状態で 16音×ユニゾン4・LP24・6スロット。**p99 が期限（2667 µs）の 50% 未満**。

## 完了条件

- `make test` が **57/57 PASS**、`make core-freestanding-check` PASS、`make wasm` 成功
- `docs_BUILD.md` にイベント種別・許可リスト・センド出力・「上書きは次のノートオンにだけ効く」を明記
- テスト51・52・54・57の実測値を報告する

## やらないこと

- `shells/`（AU・Web）の対応（M3b）。random-scale-keys 側の改修（M3b）。
- ボイスごとの LFO 速度やマクロの上書き（グローバルのまま）。ファイルの削除・移動。
