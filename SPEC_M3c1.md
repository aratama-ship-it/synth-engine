# SPEC M3c-1 — Web Worklet の時刻原点を AudioContext と統一する

対象: `shells/web/synth-worklet.js` と `shells/web/tests/`、および random-scale-keys に複製する同一Worklet。
前提: M3b-2 完了。コア・C ABI・WASMバイナリは変更しない。

## 修正する問題

ライブの `AudioContext` を開始したあとで `AudioWorkletNode` を作ると、Worklet の `renderFrame` は0から始まる。
一方、呼び出し側は `ceil(context.currentTime * context.sampleRate)` で AudioContext 全体の絶対フレームを送る。
そのためリードが「ノード作成までに経過した時間」だけ遅れる。2026-09-06のChromium再現では、500msの待機を入れた時に490.7ms遅れた。

## 契約

- 実際の `AudioWorkletGlobalScope.currentFrame` が安全な非負整数なら、各 `process()` ブロックとフレーム省略時の `voiceParam` はそれを使う。
- Node上のテスト等で `currentFrame` が無い場合だけ、既存の `renderFrame` を使う。
- `renderFrame` はフォールバックと batch の開始済み判定として残す。実Workletでは各ブロック後に AudioContext 基準の末尾へ更新する。
- 予約フレームが既に過去なら、既存どおり次のブロック先頭（offset 0）で処理する。
- 音符ID・VOICE_PARAMの同時発音契約・DSP出力・既定の旧音源経路は変えない。

## 実装

1. Workletに `audioContextFrame(fallback)` を置く。`globalThis.currentFrame` を検証して返し、存在しない環境では fallback を返す。
2. `process()` はその値でイベントリングを読む。未初期化のブロックを含め、終了時に `renderFrame` をブロック末尾へ更新する。
3. frameを省略した `voiceParam` は同じ値を使う。
4. Workletの正本を random-scale-keys の `app/synth-engine/synth-worklet.js` へ同内容で反映する。

## テストと完了条件

- `audioContextFrame` は AudioWorklet のフレームを優先し、無い場合に fallback を返す。
- frame省略の `voiceParam` が AudioContext フレームに置かれる。
- `node --test shells/web/tests/`、`make test`、`make core-freestanding-check`、`make wasm` が通る。
- `random-scale-keys` の `node app/tests/index.js` が通る。
- 同一WorkletのSHA-256が2リポジトリで一致する。
- Chromiumで、開始済みContextへ500ms後にノードを追加しても、予定時刻と実発音ブロックの差が128フレーム以内である。
- 既定URLでは synth-engine のアセット取得がないことを回帰確認する。

## やらないこと

- 同じ音の重複や同時VOICE_PARAMの修正（M3c-2）。
- 録音ログの版固定（M3c-3）。
- 既定音源の切り替え、公開、依存追加、ファイル削除・移動。
