# M4au — Preset Bridge one-click audition

## 目的

Preset Bridgeの3候補から、JSON downloadとfile pickerを挟まず、1回の明示操作でSynthEngineを開いて対応する近似patchを適用する。Serum原本、JSON保存、mapping reportの出口は維持する。

## 入力境界

- 判断ページは`bridgePreset=pianofy|morpheus|neon-drive`の短いIDだけをSynthEngineへ渡す。
- SynthEngineは固定allowlistでIDをlocal JSON pathへ解決する。queryから任意URL、filesystem path、JSON本文を受け取らない。
- patchは既存`fetchChecked`、`parsePatch`、`applyPatch`を通し、schema 1 validationと値の正規化を迂回しない。
- 明示したbridge candidateは保存済みautosaveより優先する。候補が未知、fetch失敗、validation失敗ならEPianoを保持してerror statusを出す。
- 成功後は`history.replaceState`で`bridgePreset`だけをURLから除き、Backで判断ページへ戻れる履歴を維持する。

## UI / UX

- 各候補カードの主操作を`SYNTHENGINEで開く`とする。
- `SERUM ORIGINAL`、`JSON保存`、`MAPPING`は補助出口として同じカード内に残す。
- SynthEngineは対象patch名と「Preset Bridgeから読込済み」「出力ミュート中」「鍵盤入力で開始」を既存statusに表示する。
- 自動発音、AudioContext resume、名前付き保存、新しいmodal／tabは追加しない。
- `synth-ui.js`のcache queryをM4auへ更新し、既読タブへ旧scriptを再利用させない。

## 安全条件

- 起動処理は`ensureAudio`、note-on、output gate openを呼ばない。
- 生成済み3patchのMASTER 0.20以下、Delay / Reverb OFF、Insert OFFを変更しない。
- 同一originのlocal JSON以外をfetchしない。原本presetや外部URLはこの経路で扱わない。
- 未知IDはfail closedとし、既存patch stateを部分適用しない。

## 合格条件

1. 3カードに一発起動リンクがあり、JSON保存／原本／reportも失われない。
2. 3 IDすべてが対応するpatch名で起動し、既存schema validationを通る。
3. 明示candidateがautosaveより優先し、成功後queryが除かれる。
4. 未知IDは外部fetchせず、EPianoを保持してerrorを表示する。
5. 初期出力gate、発音停止、STOP SOUNDの既存安全回帰を維持する。
6. Webテスト、diff check、390×844／1440×900の表示監査を通す。
