# M4an — 通常OSC Warp操作

## 目的

M4amでQuality Labに限定したA/B別Bend Warpを、普段のOSC A／B画面から直接編集できるようにする。DSP、パラメータID、パッチ形式は変更せず、既存のコンパクトなOSCカードへ最小の操作面だけを追加する。

## UI契約

- OSC A／Bの各波形直下に`WARP` modeと`AMOUNT`を置く。
- modeは`OFF / BEND`。現在Amountが0ならOFF、0以外ならBENDとして表示する。
- Amountは既存ID 117／118を`-1..1`で直接操作し、表示は符号付き`-100..+100%`とする。
- OFFはAmountを0へ設定する。OFFからBENDを選んだときは最後に使った非0値、未使用なら`+0.75`を使う。
- Quality LabのA/B連動比較と通常OSCのA/B別操作は双方向に表示同期する。
- mode選択後はselectのフォーカスを外し、PC鍵盤演奏へ戻りやすくする。
- 390pxで横あふれを起こさず、select／dialは44px以上を保つ。
- 色だけで状態を伝えず、`OFF / BEND`、符号、`outward / inward`を文字で示す。

## 音声安全契約

- UI操作からnote停止、voice reset、自動発音、AudioContext開始を行わない。
- 発音中のAmount変更はM4amの5 ms平滑化をそのまま使う。
- core、WASM、parameter count、engine versionはM4amから変更しない。
- 既定0と既存パッチの互換性を維持する。

## 合格条件

1. 通常URLでもOSC A／BそれぞれにWarp modeとAmountが表示される。
2. AとBを独立して変更でき、Quality Labの連動操作とも表示同期する。
3. OFF→BEND→Amount変更→OFF→BENDで最後の非0値を復元する。
4. 操作中にnote停止、reset、自動発音を行わない。
5. Webテスト、実WASM無出力安全試験、390×844／1440×900のdesign-lintを通す。
