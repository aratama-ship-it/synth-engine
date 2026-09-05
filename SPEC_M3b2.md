# SPEC M3b-2 — random-scale-keys のリード音源を synth-engine に差し替える（切り替えスイッチ付き）

対象: **`apps/music-plugins/random-scale-keys/`**（synth-engine ではない別プロジェクト）。
前提: M3b-1 完了（Web 殻に `voiceParam` / `noteOnWith` / センド出力がある）。

## 絶対条件

- ★**既定は今までどおり（旧音源）。** URL に `?engine=synth-engine` を付けたときだけ新音源になる。
  公開中の v0.21.0 の挙動を一切変えないこと。
- ★**リード（`scheduleLead`）だけを差し替える。** パッド・ベース・ドラム・SFX・リバーブ・ディレイ・
  バス構成・ステム・MIDI 書き出しには手を触れない。
- ★**イベントログの正本性を壊さない。** 同じログから同じ音が再生成できること（決定論）。

## 差し替えの設計

### インスタンスは2本（`main` と `shift`）

音色は **Shift キーで音符ごとに切り替わる**（`app/main.js:1008` の `event.shiftKey ? timbreShift : timbre`）。
synth-engine はパラメータが16声で共有なので、音色ごとに1本ずつ用意する。
**画面で選べる音色は2つ（通常・Shift）だけ**なので **2本で足りる**（各 1.26 MB）。
音色ドロップダウンを変えたときだけ、その本のプリセットを読み直す。

### 音符ごとの指定は `VOICE_PARAM` で行う（許可リスト内で足りることを確認済み）

| 元の挙動 | 差し替え後 |
|---|---|
| 緊張度Tでカットオフが決まる（音符ごとに焼き込み） | `VOICE_PARAM(37 filterCutoff, cutoffForTension(...))` |
| `sweep`（3キー）: その音だけ 400→4000 Hz へ開く | `VOICE_PARAM(37 filterCutoff, 4000)` ＋ `(40 filterEnvAmount, -3.322)` ＋ `(42 filterEgDecay, 0.3)` ＋ `(54 filterEgCurve, 1.0)` |
| `delay`（4キー）: その音だけディレイへ送る | `VOICE_PARAM(75 sendLevel, 1)` |
| `octave` / `stutter` / `arpeggio` | 今までどおり**複数回のノートオン**（アプリ側の仕事。音源側の変更なし） |
| 長押しサステイン（`hold: "open"`） | ノートオンとノートオフ。`release()` でノートオフを送る |

★`-3.322` は `-log2(4000/400)`。カーブ 1.0（直線）は Web Audio の `exponentialRampToValueAtTime` と同じ動き。

### 配線

- 各インスタンスの **出力0（ドライ）→ `leadBus`**、**出力1（センド）→ `delayInput`**。
  これで「その音だけディレイへ送る」が元と同じ形で再現できる。
- ★**例外**: `options.stemRole === "accomp"`（`synth.js` の終止和音 1箇所だけ）は
  **旧経路のまま**にする。1本のインスタンスを2つのバスへ出し分けられないため。README に明記する。

### 入口

- `createSynth(context, {...})` に **`leadNodes: { main, shift }`** を渡せるようにする（省略時は旧経路）。
  ノードの生成は非同期なので**呼び出し側で作って渡す**（`createSynth` は同期のまま）。
- `app/main.js`: URL に `?engine=synth-engine` があれば、wasm を読んで2本のノードを作り `createSynth` へ渡す。
- `app/stems.js`: ステム書き出しでも同じ切り替えが効くようにする（オフライン文脈ごとにノードを作る）。
- ★**画面左上のバージョン表示の隣に、いまどちらの音源かを出す**（例 `v0.22.0 / 音源: synth-engine`）。
  どちらで鳴っているか分からないまま判断させない。

### 音量を合わせる

旧音源と新音源で**体感音量が変わらないこと**。各プリセットの `masterGain` を調整して、
**C4・velocity 1.0 の単音の RMS が旧音源と ±1 dB 以内**に収まるようにする。
（参照値は `synth-engine/design/verify/ref/rsk_*.wav`。ピーク: epiano −6.3 / saw −7.4 / pluck −6.4 / bell −7.7 dBFS）

## テスト

`random-scale-keys` の既存テスト（`node --test`）がすべて PASS のまま。加えて:

1. **既定が変わらないこと**: `?engine` 無しのとき、`createSynth` が旧経路を使う（`leadNodes` を渡さない）。
2. **イベント変換**: `effect: "sweep"` のとき上の4つの `VOICE_PARAM` が正しい値で作られる。
   `effect: "delay"` のとき `sendLevel=1` が作られる。`effect: "none"` のとき余計な上書きが無い。
3. **音色の振り分け**: `options.timbre` が通常なら `main` ノード、Shift 側なら `shift` ノードへ行く。
4. **決定論**: 新音源で同じイベントログを2回オフラインレンダーしてビット一致。
   （既存の決定論テストの作法に合わせる。複数音階×3回の既存規約は変えない）

## 完了条件

- `?engine` 無しで従来どおり動く（**公開中の挙動が変わらないこと**を実際にブラウザで確認）
- `?engine=synth-engine` で演奏でき、`sweep` と `delay` のキーが**それらしく効く**
- 既存テストがすべて PASS、上の1〜4が PASS
- バージョンを上げ（v0.22.0）、画面にどちらの音源かを表示
- `PROJECT_NOTES.md`（random-scale-keys 側）に、差し替えの範囲・例外（accomp）・切り替え方を追記

## やらないこと

- パッド・ベース・ドラム・SFX・エフェクト・ステム構成・MIDI 書き出しの変更
- 旧音源のコードの削除（**両方残す**。判断がつくまで消さない）
- 既定の切り替え（本人が判定してから）。ファイルの削除・移動
