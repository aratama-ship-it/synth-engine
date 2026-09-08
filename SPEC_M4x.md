# SPEC M4x — 実ブラウザ OfflineAudioContext 再生成安全確認

## 目的

実ブラウザ上で `OfflineAudioContext` と実 `AudioWorkletNode` を連続生成し、保持音を含む終了済みContextの後に作る新Contextが残留出力を引き継がないことを、物理出力なしで確認する。

## 実装

- 検査ページは `shells/web/tests/context-recreate-safety.html`。HTTP配信下で自動実行する。
- 44.1 / 48 / 96 kHzごとに、最初のContextはC8・HQ FMを保持したままオフライン終了し、次のContextは新しい `OfflineAudioContext` と `AudioWorkletNode` を作る。
- 新ContextはC8を発音してnote-offし、開始前の無音・有限性・peak 0.25以下・release後の無音を確認する。
- 各測定は `OfflineAudioContext.destination` にだけ接続する。デバイス出力・通常の `AudioContext`・UIの音源開始処理は使わない。

## 合格条件

- 開始前と再生成後の開始前peak: `<= 1e-7`
- 保持音／再生成後の発音peak: `> 1e-4` かつ `<= 0.25`
- 再生成後のnote-off後tail: `<= 1e-7`
- 全レンダーの `NaN` / `Infinity`: 0件

## 境界

- これは実ブラウザのWeb Audio実装とAudioWorklet生成を確認するが、オフライン専用である。
- ライブ `AudioContext.close()`、オーディオデバイスの抜き差し、sample rateを持つ実デバイスの変更、実スピーカー出力、聴感は検証しない。
- 音源DSP、WASM、UIの挙動は変更しない。
