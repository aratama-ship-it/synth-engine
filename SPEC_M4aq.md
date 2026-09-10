# M4aq — Band-limited SYNC Warp

## 目的

OSC A/Bの既存Warpへ、master周期でwavetableの読み出し位相をresetする`SYNC`を追加する。hard sync固有の鋭い倍音変化は残しながら、周期resetの段差をPolyBLEPで補正し、保持音中のmode変更が一時的に別modeを通過しないようにする。

## パラメータ契約

- ID 119 / 120の範囲を`0..2`へ拡張し、0=`BEND`、1=`ASYM`、2=`SYNC`とする。既定値0、integerは維持する。
- `OFF`は従来どおりAmount 0で表す。既存ID、parameter count 121、C ABI、event形式、patch schema 1は変更しない。
- 旧patchの0/1は同じBEND/ASYMとして復元する。SYNC追加に伴いengine versionを28へ上げる。

## DSP契約

- SYNC比率は`ratio = 2^(2 * amount)`。Amount -1 / 0 / +1は0.25 / 1 / 4倍に対応する。
- 読み出し位相は`fract(masterPhase * ratio)`。Amount 0では既存の無変形読み出しを直接返し、旧PCMと完全一致させる。
- master周期resetの直前値と直後値から段差量を求め、現在sample幅のPolyBLEPを一度だけ加える。内部slave wrapは周期wavetable自身の連続性へ委ねる。
- mip選択は`frequency * max(1, ratio)`を使い、slave側の最高読み出し速度を下回らない。
- mode smoothingは1本の連続値を0→1→2と通さず、BEND / ASYM / SYNCの3 one-hot weightをOSCごとに5 ms補間する。BEND↔SYNC切替時にASYM weightは0のまま保つ。
- active voiceが無い状態のmode変更は即時snapし、発音中だけ5 ms補間する。note停止、包絡再trigger、voice reset、動的allocationを行わない。

## UI契約

- 通常OSC A/Bの既存selectを`OFF / BEND / ASYM / SYNC`へ拡張する。新しいカードや常時パネルは増やさない。
- SYNC状態は`SYNC -75% · stretch ×0.35`または`SYNC +75% · compress ×2.83`のように、符号、方向、比率を文字で示す。
- Amount 0はどのmodeでも`OFF · original`。OFFからSYNCへ戻した場合は各OSCの最後の非0 Amountを復元する。
- 既存波形図はSYNCの位相resetを表示し、aria-labelにもratioとstretch/compressを含める。
- 既存の44px操作、108px select幅、配色、余白、390px responsive構造を維持する。

## 合格条件

1. mode metadataが0..2で、旧BEND/ASYMとAmount 0 PCMが維持される。
2. ratio端点、SYNC正負の音差、有限値、mip契約をcore fixtureで固定する。
3. PolyBLEP版が同じmipのnaive hard syncより高域折返し指標を改善する。
4. 保持音中の全mode遷移でone-hot和が1、非対象modeが混入せず、出力がfiniteかつ既存安全上限内になる。
5. WASM無出力イベント試験でmode変更、release、panic後無音を確認する。
6. core、freestanding、WASM、Web、responsive監査を通す。

SYNCの主観的な硬さと有用なAmount範囲は自動試験では確定せず、低音量の本人試聴へ残す。
