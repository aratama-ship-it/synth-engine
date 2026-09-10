# M4ap — ASYM Warp mode

## 目的

M4am〜M4aoで追加したA/B別Bend Warpへ、周期端を固定した非対称な位相変形`ASYM`を追加する。既存`BEND`を比較基準として保持し、hard syncのような周期途中の不連続はこのwaveでは導入しない。

## パラメータ契約

- ID 119: `oscAWarpMode`、範囲`0..1`、既定値`0`、integer
- ID 120: `oscBWarpMode`、範囲`0..1`、既定値`0`、integer
- 0=`BEND`、1=`ASYM`。`OFF`は従来どおりAmount 0で表し、独立したmode値にしない。
- 既存ID 0〜118を移動しない。parameter countは121、C ABI、イベント形式、patch schema 1は変更しない。
- 旧パッチにmode値が無い場合は既定0の`BEND`になる。
- 音声結果を変えるopt-in追加としてengine versionを27へ上げる。

## DSP契約

位相`p`、Amount`a`、平滑化されたmode mix`m`（0=BEND、1=ASYM）に対して次を使う。

`p' = p + 0.85 * a * ((1-m) * sin(2*pi*p)/(2*pi) + m * p*(1-p))`

- `ASYM`単体の導関数は`1 + 0.85*a*(1-2p)`で、`a=-1..1`の全域で`0.15..1.85`。端点0／1を固定し、phase foldを起こさない。
- `BEND`と`ASYM`の補間中も二つの単調写像の凸結合なので導関数を`0.15..1.85`に保つ。
- `a == 0`はmodeにかかわらず既存位相と既存frequencyをそのまま渡し、旧PCMと完全一致させる。
- mode targetはintegerだが、内部では既存control smootherと同じ5 msで0〜1を補間する。保持音中の切替でnote停止、再アタック、voice resetを行わない。
- mip選択は従来どおり`frequency * (1 + 0.85 * abs(a))`を使う。両方式と補間中の最大局所速度を上回る。
- AはB→A FM適用後、Bは可聴信号とFM sourceの両方へ同じmode mixを使う。Sub／Noiseは変更しない。
- voice、wavetable、AudioNode、動的allocationを増やさない。

## UI契約

- 通常OSC A／BのWarp selectを`OFF / BEND / ASYM`にする。
- BEND／ASYMの切替は現在の非0 Amountを維持する。OFFはAmountだけを0へし、最後の方式と非0 Amountを保持する。
- OFFからBEND／ASYMを選ぶと、各OSCで最後に使った非0 Amountを復元し、未使用時は`+75%`。
- 状態文は`BEND +/-… · inward/outward`または`ASYM +/-… · forward/backward`とし、色だけで方式を示さない。
- 波形図とaria-labelを現在のmodeとAmountへ同期する。
- `?quality=1`の既存`BEND - / OFF / BEND +`比較はBEND専用のまま残し、押した場合はA/B modeを0へ戻してからAmountを適用する。
- 既存の44px操作、配色、余白、responsive構造を維持し、新しいカード、色、motionを追加しない。

## 合格条件

1. 既定mode 0と既存BENDのPCMがビット一致する。
2. ASYMの端点、単調性、導関数範囲、正負方向差を固定fixtureで検証する。
3. ASYMでもalias-aware mipがunguarded比較より折返し指標を改善する。
4. 保持音中のBEND↔ASYM切替が5 ms平滑化され、finite、peak上限、release／panic後無音を物理出力未接続のWASM試験で確認する。
5. 旧patchをBEND既定で復元でき、新しいA/B modeを保存・Undoできる。
6. core、freestanding、WASM、Web、design-lintを通す。

音色としての有用性とAmount適量は自動試験で確定せず、低音量の本人試聴で判断する。`SYNC`は不連続点の帯域制御を別仕様として設計する。
