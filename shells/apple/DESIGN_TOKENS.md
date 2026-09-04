# SynthEngine Apple shell — design tokens

- 作成日: 2026-09-04 / 作成: Codex
- 対象: `SynthEngineApp.app` の状態表示ウインドウのみ
- コンセプト: GUI音源の模倣ではなく、キーボード演奏へすぐ入れる小さな計器盤

## 設計メモ

1. 利用者と場面: 開発者本人がAUv3の単体発音を素早く確認する。
2. 気分: 起動・読込・演奏可否が迷わず分かり、検証へ集中できる。
3. 固有の核: A〜Z入力、AUv3状態、バッファ、サンプルレートだけを一画面に置く。
4. 踏襲/除外: macOS標準ウインドウと標準書体を踏襲し、ノブ、鍵盤絵、発光、装飾カードは置かない。
5. 機能条件: 560×240 pt、キーフォーカスを主画面が保持、Dockアイコンなし、情報を隠さない。

## 数値

| 種別 | トークン | 値 |
|---|---|---|
| 色 | background | `#F4F1E8` |
| 色 | text | `#1C1C1C` |
| 色 | secondary text | `#474747` |
| 色 | status | `#7D3314` |
| 文字 | version / format / status / detail / title | `12 / 12 / 13 / 14 / 30 pt` |
| 余白 | edge / title gap / detail gap | `24 / 28 / 8 pt` |
| 形状 | window | macOS標準。追加の角丸・影なし |
| 動き | transition | なし |

コントラストは `design-web/tools/contrast.mjs` で提出前に実測し、結果をREADMEへ記録する。
