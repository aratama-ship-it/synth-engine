# SPEC M2 — random-scale-keys の4音色（epiano / saw / pluck / bell）を synth-engine で再現する

前提: M1c 完了（パラメータ 0〜74、engine version 6）。
目的は **M3（random-scale-keys の音源差し替え）で音が劣化しないこと**を、本人の耳で確認できる状態にすること。

## 元の実装（`random-scale-keys/prototype/synth.js` を Claude が読解、2026-09-05）

`scheduleLead()` が音色ごとに次の構成を組む。`cutoff` は緊張度Tで動く（既定の下限 1200 Hz）。

| 音色 | 構成 | ADSR（秒） | フィルタ |
|---|---|---|---|
| **epiano** | ①FM: sine搬送波 + sine変調波（**周波数×2**）、変調量 **300→40 Hz を0.25秒で指数減衰**<br>②sine **+12半音**、音量は①の18% | 0.005 / 0.35 / 0.2 / 0.25 | LP・Q0.7・**カットオフ固定** |
| **saw** | sawtooth **×2声**（デチューン **−6 / +6 cent**、パン **−0.2 / +0.2**） | 0.008 / 0.5 / 0.3 / 0.6 | LP・**Q4**・**カットオフ×1.8 → ×1 を0.4秒で指数減衰** |
| **pluck** | ①triangle **×2声**（デチューン **0 / +5 cent**、パン **−0.15 / +0.15**）<br>②**6ms のホワイトノイズ**を別レイヤーで重ねる（専用LP、6msで消える） | 0.003 / 0.28 / 0.12 / 0.12 | LP・Q0.7・**カットオフ×2.2 → ×1 を0.15秒で指数減衰** |
| **bell** | ①FM: sine搬送波 + sine変調波（**周波数×3.5**＝非整数比）、変調量 **220×velocity → 40 Hz を0.6秒で減衰**<br>②sine **+12半音**、音量は①の25% | 0.002 / 1.2 / 0.05 / 0.6 | LP・Q0.7・**カットオフ固定** |

★`exponentialRampToValueAtTime` は**対数周波数上で直線**に動く。つまり saw / pluck のフィルタ変化は
**オクターブ単位で直線** ＝ synth-engine の `filterEgCurve = 1.0`（直線）と一致する。

## 写像の方針（Claude の設計判断）

1. **FM の深さのエンベロープは、フィルタEGをモジュレーションマトリクス経由で使う。**
   epiano / bell は元の実装でフィルタEGを使っていないため競合しない。
   フィルタEGは `filterEnabled=0` でも進むことを確認済み（`engine.cpp` の `advance_filter_envelope` は無条件に呼ばれる）。
   結線: `modSlot0Source = 3`（フィルタEG）→ `modSlot0Dest = 5`（FM B→A）。
   `fmBToA` 本体が減衰後の下限、マトリクスの `amount` が上乗せ分になる。
2. **1オクターブ上の sine レイヤーはサブオシレーターで作る。** そのために
   **`subOctave` の範囲を `-2..0` から `-2..+1` へ広げる**（既定 −1 は変えない＝後方互換）。
   `subShape=0`（sine）、`subOctave=+1`、`subLevel` で比率を作る。
   ★命名は「サブ」のままだが、実体は「単純波形の追加レイヤー」。docs に明記する。
3. **FM の深さがピッチに依存しない差を、必要なら埋められるようにする。**
   元の実装は変調量が Hz 固定なので **高い音ほど FM が浅く（丸く）なる**。synth-engine は一定。
   埋めたい場合は `modSlotNSource = 5`（ノート位置）→ `Dest = 5`（FM B→A）に**負の amount** を入れる。
   ★まずは埋めずに作り、A/B で本人が「高音が硬い」と感じたら足す。**先回りで足さない。**
4. **Q4 の換算**: SVF は `k = 2 − 1.99×resonance`、`Q = 1/k`。`Q=4 → k=0.25 → resonance = 0.879`。
5. **カットオフ倍率の換算**: `×1.8 → +log2(1.8) = 0.848 オクターブ`、`×2.2 → +1.138 オクターブ`。
   `filterEnvAmount` に入れ、`filterEgSustain = 0`、`filterEgCurve = 1.0`（直線）とする。
6. **pluck のノイズ**は `noiseLevel` ＋ `noiseDecay = 0.006`（6ms）で作る。元は別レイヤーで独立LPを通すが、
   synth-engine ではボイスのフィルタを共有する。**この違いは許容し、耳で判定する。**
7. **ユニゾンのデチューンは左右対称**（synth-engine の仕様）。pluck の「0 / +5」は「±2.5」で近似する。

## 作業（4段階）

### M2-1 参照音の書き出し（Claude が行う。product code ではなく検証道具）

- `tools/serve.mjs` に **読み取り専用の第2マウント** `/ref/` を足し、
  `random-scale-keys/prototype/` を見せる（同一オリジンにして下の harness から import するため）。
  ★このマウントは検証専用。書き込みは不可。パス脱出は既存のガードと同じ方式で塞ぐ。
- `POST /refwav?name=<英数字>` を足し、本文（WAV バイナリ）を `build/ref/<name>.wav` へ保存する。
  上限 8 MB、名前は `[a-z0-9_]+` のみ。
- `tools/ref-render.html` を作る: `/ref/synth.js` を import し、
  **4音色それぞれについて C4 単音（velocity 1.0・length 1.5秒・effect なし・tension 0）を
  OfflineAudioContext で 3秒レンダー**して `POST /refwav` する。
  ★元の実装はリバーブ・ディレイ・バス処理を通るので、**leadBus 直前のドライ音**を取り出すこと
  （`destinationNode` を専用の GainNode にして、そこから録る）。難しければ全体を録り、その旨を記録する。

### M2-2 コアの小改修（Codex へ委譲）

- `subOctave` の範囲を `-2..0` → `-2..+1` に変更（`params.hpp` のテーブル）。既定 −1 は変えない。
- テスト49を追加: `subOctave=+1` で**サブがノートの1オクターブ上で鳴る**（ピーク周波数が2倍±2%）。
- ★既存48項目は全て PASS のまま、既存プリセットの出力はビット一致であること。

### M2-3 プリセットの当てはめ（Claude が行う）

`presets/rsk_epiano.txt` / `rsk_saw.txt` / `rsk_pluck.txt` / `rsk_bell.txt` を作る。
上の表と換算に従って初期値を置き、**参照音と数値で比較しながら詰める**:

- 振幅包絡: 20ms 窓の RMS 列を取り、**相関 0.95 以上**を目標
- 音色: スペクトル重心の時間変化（微分ベースの推定量）を比べ、**平均の差 15% 以内**を目標
- ★零交差率は波形が変わると当てにならないので使わない（2026-09-05 の教訓）

数値が目標に届かない項目は、**無理に合わせず差分として記録する**（構造的に違う箇所があるため）。

### M2-4 A/B 試聴（本人の耳ゲート）

- `design/listen/index.html` に **旧音源と新音源を交互に並べた比較節**を作る。
  4音色 × （旧 / 新）＝ 8 音。**同じ音符・同じ長さ・ラウドネス整合（ピーク −1 dBFS に正規化）**にする。
- 本人が音色ごとに「置き換えてよい / まだ違う」を判定する。**ここが M2 のゲート。**

## 完了条件

- `make test` が 49/49 PASS、`make core-freestanding-check` PASS、`make wasm` 成功
- 4つのプリセットが `nan_count=0` でレンダーでき、参照音との比較数値が記録されている
- 試聴ページに A/B 比較節があり、本人が判定できる状態
- `PROJECT_NOTES.md` に「合わせられなかった差」を明記

## やらないこと

- 元の実装のエフェクト（delay / sweep / stutter / arpeggio / octave）の再現。これらは
  random-scale-keys 側のイベント生成の役目で、音源の役目ではない（M3 で接続する）
- リバーブ・ディレイ・バス処理の移植（**ドライ音の一致までが M2 の範囲**。M0 からの方針どおり）
- 「先回りでピッチ依存の FM」を足すこと（本人が必要と言ったら足す）
