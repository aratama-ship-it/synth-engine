# M4am — OSC Bend Warp比較

## 目的

WT POSとは独立した周期内phase warpをOSC A/Bへ追加し、一つのwavetableから倍音輪郭を広げる。最初の公開面は通常UIではなく`?quality=1`のQuality Labに限定し、`BEND - / OFF / BEND +`を同条件で比較できるようにする。

## パラメータ契約

- ID 117: `oscAWarpAmount`、範囲`-1..1`、既定値`0`
- ID 118: `oscBWarpAmount`、範囲`-1..1`、既定値`0`
- 既存IDは移動しない。C ABIとイベント形式は変更しない。
- engine versionは25、parameter countは119。
- amountは既存control smootherで5 ms平滑化する。

## DSP契約

位相`p`とamount`a`に対して次を使う。

`p' = p + 0.85 * a * sin(2*pi*p) / (2*pi)`

- `a == 0`は明示的に既存位相と既存frequencyをそのまま渡し、旧PCMと完全一致させる。
- `a > 0`はBEND +（周期中央へ寄せる）、`a < 0`はBEND -（周期端へ引く）。
- 導関数は`1 + 0.85*a*cos(2*pi*p)`、全範囲で`0.15..1.85`のため単調でphase foldを起こさない。
- mip選択のfrequency hintは`frequency * (1 + 0.85 * abs(a))`とし、最大局所速度を上限に帯域を保護する。
- AはB→A FMのphase offset適用後にwarpする。
- Bは可聴信号とAのFM sourceの両方へ同じwarpを通す。
- SubとNoiseはwarpしない。
- voice、wavetable、AudioNode、動的allocationを増やさない。

## UI契約

- `?quality=1`だけに`OSC BEND WARP`を表示する。
- 固定比較値はBEND - = `-0.75`、OFF = `0`、BEND + = `+0.75`。
- Quality Labの3ボタンはA/Bを連動して変更する。コアとパッチ保存ではA/B別値を保持できる。
- 操作中のnote停止、reset、再アタック、AudioContext開始を行わない。
- 波形図は同じphase mappingで即時更新し、aria-labelにも方向と量を含める。
- 44px以上、390pxで横あふれなし、選択は文字・枠・`aria-pressed`で表す。

## 合格条件

1. default PCM goldenが完全一致する。
2. mappingが有限・単調で、0／0.5／1の基準点と導関数範囲を守る。
3. BEND -／OFF／BEND +のPCMが固定fixtureで区別できる。
4. alias-aware mipがunguarded比較より折返し成分を減らす。
5. ID 117／118が5 ms smoothing契約へ含まれる。
6. 実WASM・物理出力未接続でheld note中に-→OFF→+を切り替え、NaN／Infなし、peak上限内、release／panic後0を確認する。
7. core、freestanding、WASM、Web、design-lintを通す。

音の有用性と好みは自動試験で確定せず、低音量の本人試聴で判断する。
