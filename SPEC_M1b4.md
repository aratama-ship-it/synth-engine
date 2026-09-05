# SPEC M1b-4 — 乱数ハッシュを「経路に依存しない値」にする（AU と CLI の音を一致させる）

対象: `core/` のみ。前提: M1b-3 完了（パラメータ 0〜54、engine version 4）。

## なぜ直すか（実測した不具合）

**同じプリセットと同じ演奏なのに、AU（Logic）とオフラインレンダラーで音が違う。**

- 実測（2026-09-05）: `presets/m1_unison_saw.txt` と `presets/m1b_filter_sweep.txt` を
  `fixtures/au_compare_vel1.txt`（ベロシティ 1.0）で描くと、AU と CLI の差が最大 −5〜6 dBFS。
  `presets/m0_saw.txt`（M0a 相当）は**ビット一致**する。
- 原因: 乱数ハッシュの入力に **`event.id`（ノートID）** を使っている箇所があるため。
  - `note_on()` の `hashed_phase(engine, event.id, voiceIndex, layer)` — OSC A / OSC B / サブの初期位相（3か所）
  - `render_noise()` の `hash32(engine->seed, voice->noteId, sampleIndex, 3u)` — ノイズ
- **MIDI 1.0 にはノートIDが無い**ので、AU は `channel * 128 + note` で代用している。
  イベントログ側は任意のID（フィクスチャでは 100/101/102）。当然ハッシュが変わり、位相とノイズが変わる。
- M0a 相当のプリセットが一致するのは、そこだけ固定位相 0.25 の旧経路を通るため。

これは**「ひとつのコアを3つの殻で鳴らし、同じプリセットから同じ音を出す」という本プロジェクトの核**に反する。

## 直し方

`Voice::startOrder`（ノートオンごとに `++engine->orderCounter` で振られる通し番号）を使う。
**同じイベント列を同じ順に処理すれば、経路が違っても必ず同じ値**になる。

1. `hashed_phase()` の第2引数に渡す値を、`event.id` から
   **`static_cast<uint32_t>(voice->startOrder)`** に変更する（3か所すべて）。
2. `render_noise()` のハッシュ入力を、`voice->noteId` から
   **`static_cast<uint32_t>(voice->startOrder)`** に変更する。
3. `Voice::noteId` は**ボイスの割り当て・ノートオフの対応付けにはこれまでどおり使う**（削除しない）。
   乱数の入力にだけ使わない。
4. `lfo_hash_value()` は `cycleIndex` と `voiceIndex` だけを使っており経路に依存しないので**変更しない**。
5. 他にハッシュを使う箇所があれば同様に監査し、経路依存の入力（noteId、イベントのid）を使っていないか確認する。

## 影響と、守るべきこと

- ★**M0a 相当のプリセットの出力はビット一致のまま**であること（旧経路は固定位相 0.25 なので影響しない）。
  基準: `/tmp/g3_m0.wav`（`presets/m0_saw.txt` + `fixtures/m0_events_chord.txt`、48000Hz block128 96000frames）。
- ★**M1a・M1b のゴールデンは変わってよい**（位相が変わるため）。本人承認済み。
  ただし「音楽的な性格が変わらない」ことを下のテストで担保する。
- `synth_engine_version()` を **5** に上げる。

## テスト（39〜41 を追加。既存38項目は壊さない）

39. **M0a のビット一致**: 上の基準ファイルと一致すること。
40. **経路非依存**: 同じプリセット・同じノート列を、**イベントIDだけ変えて**2回レンダーし、**ビット一致**すること。
    - 具体例: `fixtures/au_compare_vel1.txt`（id 100/101/102）と、
      新規 `fixtures/au_compare_vel1_altids.txt`（**同じ時刻・同じノート・同じベロシティで id だけ 60/64/67**）
    - プリセットは `presets/m1_unison_saw.txt` と `presets/m1b_filter_sweep.txt` の2種で行う
    - **これが今回の中心のテスト。** これが通れば AU と CLI が一致する
41. **音楽的な性格の保存**: 変更前後で `presets/m1_unison_saw.txt` の
    (a) RMS の差が **1 dB 以内**、(b) スペクトル重心の差が **10% 以内** であること
    （位相が変わっても音色は変わらないことの担保）。
    **変更前の実測値（2026-09-05・Claude 計測、`fixtures/listen_chord.txt`・48kHz・96000frames）**:
    `presets/m1_unison_saw.txt` → **RMS = −22.180 dBFS ／ 明るさ（零交差率、0.2〜0.4秒）= 1388 Hz**。

## 完了条件

- `make test` が **41/41 PASS**。
- `make core-freestanding-check` PASS、`make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang` 成功。
- `docs_BUILD.md` の未決事項から「位相のねじれ」に関する記述を更新し、
  **「乱数の入力は経路非依存の値に限る」を設計原則として明記**する。
- テスト40・41の実測値を報告する。

## やらないこと

- `Voice::noteId` の削除。ボイス割り当てロジックの変更。`shells/` `tools/` `design/` の変更。ファイルの削除・移動。
- M1a に残る「ユニゾン1声のときだけ固定位相 0.25」のねじれ（これは M0a 互換のために残す。今回は触らない）。
