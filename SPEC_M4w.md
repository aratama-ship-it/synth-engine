# SPEC M4w — AudioWorklet 再生成／sample-rate 安全回帰

## 目的

異なる sample rate の AudioContext へ切り替わる前提で、旧 Worklet の保持音が安全な reset 後に残留せず、新しい Worklet が無音から有限・上限内で発音できることを回帰で固定する。

## 対象

- `shells/web/tests/audio-safety.test.mjs` に、実 `build/synth_engine.wasm` を使う無出力の AudioWorkletProcessor 検査を追加する。
- 44.1 / 48 / 96 kHz ごとに新しい `SynthEngineProcessor` を生成する。
- 各 processor は、初期 8 block の無音、C8・HQ FMの保持音の有限性と peak 0.25 以下を検査する。
- 次の rate へ移る前に前の processor へ `reset(VOICES)` を送り、8 block の無音を確認する。最後の processor も同じ条件で終了する。
- `globalThis.sampleRate` をテスト内だけで切り替え、他の Web テストと並列実行しない。

## 安全境界

- AudioContext・AudioWorkletNode・物理出力には接続しない。測定値は Worklet 出力バッファだけを対象にする。
- 音色、DSP、WASM、UI、AudioContext のライフサイクルは変更しない。
- `NaN` / `Infinity` は 0 件、保持中 peak は 0.25 以下、reset 後は `1e-7` 以下を必須とする。

## この回帰が証明しないこと

- 実ブラウザ／実デバイスで AudioContext の sample rate をライブ切替することは検証しない（ブラウザの sample rate は通常 Context 作成時に固定される）。
- Worklet module のネットワーク取得・ブラウザの module cache・オーディオデバイスの抜き差し・実スピーカー出力は対象外。
- 聴感上の音質、Legacy/HQ の優劣、実デバイスの確認は本人による低音量試聴を要する。
