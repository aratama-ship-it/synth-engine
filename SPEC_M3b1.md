# SPEC M3b-1 — Web 殻に「音符ごとのパラメータ上書き」と「センド出力」を通す

対象: `shells/web/` のみ。前提: M3a 完了（パラメータ 0〜75、engine version 7、`synth_process_send` あり）。
`core/` は変更しない。

## なぜ作るか

M3a でコアに入れた2機能が、まだ Web 側から使えない。次の M3b-2（random-scale-keys の音源差し替え）で
`sweep`（その音だけフィルタが開く）と `delay`（その音だけディレイへ送る）を作るために必要。

## 1. `synth-worklet.js`: 出力を2系統にする

- `AudioWorkletProcessor` の出力を **2つ**にする（`outputs[0]`＝ドライ、`outputs[1]`＝センド）。どちらもステレオ。
- レンダーは `synth_process` ではなく **`synth_process_send`** を呼び、センドを `outputs[1]` へ書く。
- ★**センドを使わない場合の挙動を変えないこと**。`sendLevel` が 0 なら `outputs[1]` は無音になる（コアの仕様）。
- wasm のリニアメモリにセンド用のバッファ（左右）を追加で確保する。`maxBlock` 分。

## 2. `synth-worklet.js`: `voiceParam` メッセージ

- MessagePort で `{type:"voiceParam", params:[[id, value], ...], frame?}` を受け取る。
  - `frame` があれば絶対フレーム位置、無ければ「次に処理するブロックの先頭」。
  - 内部では **`SYNTH_EV_VOICE_PARAM`（kind=5）のイベント**として、既存のイベントリングへ入れる。
  - ★**同一フレームでは NOTE_ON より前に並ぶこと**（コアが並べ替えるが、リングへ入れる時点でも順序を壊さない）。
- 既存の `{type:"events"}` でも kind=5 のイベントを受け付けられること（`batch` からも使えるように）。

## 3. `synth-node.js`: API を足す

```js
voiceParam(params, atFrame = defaultFrame(context))   // params は [[id, value], ...]
noteOnWith(note, velocity, params, atFrame)           // voiceParam → noteOn を同じフレームでまとめて送る便利版
get sendOutput()                                      // センド出力に繋ぐためのもの（下記）
```

- **センド出力の繋ぎ方**: `AudioWorkletNode` は複数出力を持てるが、`node.connect(dest)` は既定で出力0に繋がる。
  センドは `node.connect(dest, 1)` で繋ぐ。`synth-node.js` の `connect(destination, outputIndex = 0)` を
  **省略可能な第2引数**で受けられるようにする（既存の呼び出しは今までどおり動くこと）。
- `noteOnWith` は「上書き→ノートオン」の順序を保証する。**M3b-2 で最も使う API。**

## 4. `demo.html` に確認用の操作を足す

- 「音符ごとの上書きを試す」ボタン: 同じ音を3つ鳴らし、**2つ目だけ** `filterCutoff` を上げる。
  聴いて2つ目だけ明るいことが分かるようにする。
- 「センドを試す」ボタン: センド出力を分かりやすい別経路（例: 大きめのディレイ）に繋ぎ、
  **2つ目の音だけ**にディレイが掛かるようにする（`sendLevel` を音符ごとに上書き）。
- 既存の表示・機能は壊さない。

## 5. テスト（`shells/web/tests/`）

- `voiceParam` のメッセージが正しい `SYNTH_EV_VOICE_PARAM` イベントへ変換されること（既存のリング変換テストと同じ方式）。
- `noteOnWith` が「同一フレームで上書き→ノートオンの順」に並べること。
- `connect(dest, 1)` が出力1へ繋ぐこと（`AudioWorkletNode.connect` の呼び出し引数を検査する形でよい）。
- 既存テストはすべて PASS のまま。

## 6. オフラインでの数値検証（重要）

`tools/` に **`tools/web-voiceparam-check.mjs`** を追加し、node 上の wasm で次を確かめる:

- 同じプリセットで3音を鳴らし、2音目の直前にだけ `VOICE_PARAM(37 filterCutoff, 4000)` を置く。
- **CLI（`render-cli`）で同じイベント列を描いた結果とビット一致**すること。
  （＝Web 経路がコアと同じ結果を出すことの担保。M3a のテスト51と同じ設定にすればよい）
- センドについても、`sendLevel` を音符ごとに変えた場合の**センド出力**が CLI と一致すること。
  CLI 側にセンドを書き出す手段が無ければ、`render-cli` に `--send-out FILE` を足してよい
  （**その場合のみ `tools/render-cli/main.cpp` の変更を許可する**。core は触らない）。

## 完了条件

- `node --test shells/web/tests/` が PASS（既存＋新規）
- `node tools/web-voiceparam-check.mjs` が **ビット一致**を報告
- `make test` が 57/57 PASS のまま、`make wasm` 成功
- `shells/web/README_web.md` に新 API と「センドは `connect(dest, 1)`」を追記

## やらないこと

- `core/` の変更。random-scale-keys 側の改修（M3b-2）。AU 側の対応（別途）。ファイルの削除・移動。
