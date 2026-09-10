# M4ao — Warp Matrix destinations

## 目的

M4anで通常OSC A／Bへ出したBend Warp Amountを、既存6-slot MatrixからA/B別に動かせるようにする。新しい変調器や画面は増やさず、LFO 1／2、Amp／Filter／Mod Envelope、Velocity、Key Track、Macro 1〜4をそのまま利用する。

## Matrix契約

- destination 14: `OSC A Warp`
- destination 15: `OSC B Warp`
- 既存destination 0〜13の番号と意味は変更しない。
- 6つのdestination parameter（ID 56 / 59 / 62 / 65 / 68 / 71）の範囲を`0..15`へ広げる。
- full-scaleはA/Bとも`1.0`。実効値は`clamp(base + source * amount, -1, 1)`とする。
- 同じdestinationへの複数slotは既存契約どおり合算後に1回だけclampする。
- parameter count 119、C ABI、イベント形式、patch schemaは変更しない。opt-inのPCM経路追加としてengine versionを26へ上げる。

## DSP契約

- A/BのbaseはID 117 / 118の既存5 ms control smootherを通す。
- Macro 1〜4は既存5 ms smoother、LFO／Envelopeは既存の連続source値を使い、Matrix側で別の発音やresetを起こさない。
- 実効値が0を横切っても同じBend式を連続評価し、note停止、再アタック、voice resetを行わない。
- AはB→A FM適用後の読出し位相へ実効Warpを使う。
- Bは可聴信号とB→A FM sourceの両方へ同じ実効Warpを使う。
- mip選択は実効Warpの最大局所速度を使い、変調時もM4amのalias guardを維持する。
- voice、wavetable、AudioNode、動的allocationは増やさない。

## UI契約

- Matrixのdestination選択へ`OSC A Warp`／`OSC B Warp`を末尾追加する。
- 通常OSC A／BのAmount操作へ既存形式の`+ MOD`を表示し、押すと対応destinationの既存dialogを開く。
- routeありは既存の文字、背景、aria-labelで示し、色だけに依存しない。
- 新規カード、新色、新しいモーダル、常時アニメーションは追加しない。
- 390pxで横あふれを起こさず、`+ MOD`を含む操作対象は44px以上を保つ。
- route作成／削除はbase Amount、note、AudioContextの状態を変更しない。

## 合格条件

1. 既存13 destinationの番号と既定PCMが変わらない。
2. destination 14 / 15がA/B別にPCMを変え、full-scaleで`-1..1`へclampされる。
3. 変調中もfinite出力、peak上限、release／panic後無音を物理出力未接続のWASM試験で確認する。
4. Matrix一覧とOSC A／Bの`+ MOD`が同じ6-slot値を編集する。
5. core、freestanding、WASM、Web、design-lintを通す。

Warp変調の音楽的な深さと速さは自動試験で確定せず、低音量の本人試聴で判断する。
