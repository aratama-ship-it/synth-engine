# M4at — Serum 2 conservative modulation bridge

> **M4av correction:** Serum 2実画面とPianofy payloadの照合により、source IDは`2 = ENV 1`、`3 = ENV 2`、`4 = ENV 3`、`5 = ENV 4`、`6 = LFO 1`、`17 = Note#`と訂正した。以下のM4at記録にある`1..4 = ENV 1..4`という当初仮説はM4avで置き換えられている。

## 目的

M4arの数値patchへ、意味を確認できる単純なmodulation routingだけを既存6-slot Matrixとして追加する。Serum 2の64-slot Matrixを互換再生するのではなく、SynthEngineで編集を始められる少数経路へ保守的に縮約する。

## 根拠と境界

- Xfer Records公式Serum 2 User Guideは、4 Envelope、8 Macro、64 modulation slot、49 source、main / aux source、curve、polarityを持つことを示している。
- このMacのfactory preset payloadでは`Env0..3`、`Macro0..7`、`ModSlot0..63`を確認した。slotの`source[0]`について、1..4とEnvelope、25..32とMacroが同順序で対応すると判断したが、公開されたfile schemaではないため変換reportでは`approximate`とする。
- 初期sliceはSerum ENV 1..3 → SynthEngine `ENV 1 · Amp / ENV 2 · Filter / ENV 3 · Mod`、Serum Macro 1..4 → SynthEngine Macro 1..4だけをsourceとして受け付ける。
- ENV 4、Macro 5..8、LFO、Velocity等のsourceはこのwaveでは変換しない。LFOは任意curve、one-shot / envelope / free mode、unipolar / bipolarの差を先に解決する必要がある。
- aux source（`source[1] != 0`）、bypass、bipolar、curve-in / curve-out / output curveを持つrouteは単純化せずreport-onlyにする。

公式参照:

- https://www.xferrecords.com/manual/serum-2/docs — Using the Modulation Matrix
- https://xferrecords.com/manual/serum-2 — Exploring Sound Modulation / Using Macros

## 対応destination

| Serum module / parameter | 条件 | SynthEngine destination |
|---|---|---|
| `Oscillator.kParamVolume` | module 0 / 1 | OSC A / B Level |
| `WTOsc.kParamTablePos` | module 0 / 1 | OSC A / B Position |
| `WTOsc.kParamWarp` | module 0 / 1 | OSC A / B Warp |
| `VoiceFilter.kParamFreq` | module 0 | Filter Cutoff |
| `VoiceFilter.kParamReso` | module 0 | Filter Resonance |
| `Oscillator.kParamDetune` | module 0 | OSC A Detune |

- Serum amountは基本的に`-100..100`をSynthEngine `-1..1`へ近似する。
- OSC LevelだけはSynthEngine destination full-scaleが4.0のため、100%をlevel +1.0相当にする目的でさらに1/4する。
- 変換後もMatrix destination固有の応答は一致しないため、全routeを`approximate`と表示する。

## Envelope / Macro

- 変換されたENV 2 routeがある場合だけ`Env1` ADSRをSynthEngine Filter Envelopeへ移す。
- 変換されたENV 3 routeがある場合だけ`Env2` ADSRをSynthEngine Mod Envelopeへ移す。
- ENV 1は既存AMP Envelope変換を再利用する。
- 変換されたMacro 1..4だけ、`kParamValue / 100`を対応するSynthEngine Macroへ移す。
- Envelope curve / hold / sync、Macro 5..8は未対応として保持する。

## 6-slot縮約

1. `ModSlot0..63`を番号順に読む。
2. bypass、aux、bipolar、curve付き、未知source / destinationをskipして理由をreportへ残す。
3. 対応routeを先頭から最大6件だけ格納する。
4. 7件目以降は`SynthEngine Matrix capacity is six routes`としてskipする。
5. report version 2へ`modulation.capacity / transferred / skipped`を追加する。patch schemaは1のまま。

## 安全条件

- M4asのMASTER 0.20以下、Delay / Reverb OFF、Insert OFFを維持する。
- import自体、Matrix route適用、Macro値復元で自動発音しない。
- actual 3 presetを物理出力未接続の実WASMへ読み、有限値、peak 0.25以下、note-off後tail、panic後tailを検査する。
- source preset、wavetable、sample、decoded payloadをworkspaceへ複製しない。既存出力を上書きしない。

## UI / UX

- 通常Synth UIは変更しない。変換routeは既存MATRIXタブで編集する。
- Preset Bridge判断HTMLの3カードへ`MATRIX x / y ROUTES`を1行追加し、patch / report linkをversion 2出力へ差し替える。
- Matrixを移せなかった候補も成功扱いにせず、`0 / active routes`と理由をreportで確認できるようにする。
- 入力のSerum 2 `.SerumPreset`と出力のSynthEngine `.synthengine.json`を同じ「preset」として曖昧に表示しない。JSONはSerumで開けず、Serum → SynthEngineの一方向変換であること、Serum原音はfactory browserの同名presetから開くことを試聴手順と各カードへ明記する。
- 3件の比較カードは、変換後JSONとは別に`SERUM ORIGINAL`を置く。これは`tools/serve.mjs`が127.0.0.1で待ち受けている時だけ、固定allowlistの3原本をread-onlyでstreamする。任意のfilesystem pathは受けず、workspace・public buildへ原本を複製せず、`Content-Disposition`で実際の`.SerumPreset`名を返す。

## 合格条件

1. synthetic fixtureでsource / destination / amountが期待する3 core IDへ決定的に変換される。
2. bypass / aux / bipolar / curve / unknown / capacity超過がpartial routeを残さずskipされる。
3. ENV / Macro値が実際に使われるsourceだけ復元される。
4. 3候補のversion 2 patchがschema validationと物理出力未接続安全レンダーを通る。
5. 既存bridge fail-closed試験、Web 76件、diff checkを維持する。
