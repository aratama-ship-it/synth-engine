# SPEC M3c-2 — 同時発音の VOICE_PARAM を音符バンドルとして処理する

Status: **実装済み・ローカル検証済み**。この仕様は同時発音における設定の対応付けだけを扱う。音高と発音インスタンスのIDを分ける M3c-3 は別仕様で決める。

対象: `core/`、`shells/web/`、`random-scale-keys/app/synth-engine/` と対応テスト。

前提: M3c-1（AudioContext と Worklet の時計原点統一）が完了していること。C++20コア、C ABI、旧音源経路、AUの通常MIDI経路は維持する。

## 問題

現在は同じサンプル位置の `VOICE_PARAM` をすべて先に待機領域へ集め、その後で `NOTE_ON` をすべて処理する。最初の `NOTE_ON` が待機領域を消費するため、複数音の設定が混ざる。

実Workletと既存WASMの再現では、同時刻の「通常C4 → delay付きG4」でセンドが誤ってC4と完全一致した。また「send=1 → send=0」ではセンド全体が0になった。これは `synth-node.js` が作る個々の `VOICE_PARAM* → NOTE_ON` の並びを、Workletの種別ソートとコアの二段階処理が崩すためである。

## 採用する契約: 順序保存の音符バンドル

同一offsetのイベント配列では、**入力配列の順番を意味のある契約**とする。1回の発音は次の連続範囲である。

```text
VOICE_PARAM*  NOTE_ON
```

- `VOICE_PARAM*` は0個以上、直後の `NOTE_ON` だけに適用される。
- 同じoffsetで複数バンドルを置ける。例:

```text
[ NOTE_ON C4 ] [ VOICE_PARAM send=1, cutoff=4000, NOTE_ON G4 ]
```

  C4は既定値、G4だけが `send=1` と `cutoff=4000` を持つ。
- 同じパラメータを1バンドル内で複数回指定したときは、最後の値が勝つ。
- `NOTE_OFF` は従来どおり同offsetの `NOTE_ON` より先に処理する。`PARAM` / `MACRO` も従来どおり先に反映する。
- それ以外の `VOICE_PARAM` と `NOTE_ON` は、同一offsetでは入力順に一つずつ処理する。`NOTE_ON` ごとに待機中の上書きを消費・消去する。
- `VOICE_PARAM` がブロック末尾にあり、次の `NOTE_ON` が次ブロック先頭にある場合は、待機状態を持ち越す（M3aの既存契約を維持）。
- `VOICE_PARAM` を単独で使う低水準APIは、**後から送ったNOTE_ONへ遡及適用しない**。同時発音へ設定を結ぶ呼び出しは `noteOnWith()` を正規入口とする。

この契約は音高や発音IDを参照しない。したがって、M3c-3で同音連打用の一意な発音ハンドルへ移行しても、バンドルの意味は変わらない。

## 境界ごとの変更

### C++ core

- `SynthEvent` のサイズ・フィールド・イベント種別は変更しない。C ABIのバイナリ形状は維持する。
- `synth_process_send` の各サンプルで、`NOTE_OFF` → `PARAM/MACRO` → **入力順の `VOICE_PARAM` / `NOTE_ON`** の順に処理する。
- 現在の「すべてのVOICE_PARAMを走査してからすべてのNOTE_ONを走査」の2ループを、同一イベント配列を順に走査する1ループへ置き換える。
- `VOICE_PARAM` を使わない入力のPCMは既存ゴールデンとビット一致にする。
- 同時発音の意味が変わるため、実装時に `synth_engine_version()` を 7 から 8 へ上げる。

### Web Worklet / Node API

- `AbsoluteEventRing.takeBlock()` は同一offsetを `sequence` だけで安定ソートする。VOICE_PARAMを種別だけで前へ集める比較を廃止する。
- `noteOnWith(note, velocity, params, atFrame)` は既存どおり1回の `{type:"events"}` メッセージに、`VOICE_PARAM* → NOTE_ON` の連続配列を入れる。これを同時発音の正規APIとする。
- `voiceParam(params, atFrame)` は残すが、単独NOTE_ONとの組み合わせで設定対象を保証する用途には使わない。READMEと型注記で `noteOnWith` を案内する。
- canonical `shells/web/` と random-scale-keysへ複製した `app/synth-engine/` のWorklet / Node APIは、実装後にSHA-256一致を確認する。

### random-scale-keys

- `scheduleSynthEngineLead()` は既に各音に対して `noteOnWith()` を呼ぶため、呼び出し形は変えない。
- octave・stutter・arpeggio・通常音・Shift音・再生・オフラインstemのいずれも、各 `scheduleSingle()` を独立バンドルとして送る。
- 既定のlegacy音源、既存のログ形式、公開状態はこの作業で変更しない。

## 実装前に追加する失敗テスト

1. 同一offsetの `通常C4` と `send=1 のG4`。G4だけがセンドへ入る。
2. 上と入力順を反転しても、設定が指定した音に残る。
3. 同一offsetの3バンドル（`send=0 / 0.5 / 1`）で、それぞれのドライ／センド比を照合する。
4. octave効果（同時2音）と、通常音＋delay音の同時予約を同じblockで確認する。
5. `VOICE_PARAM` をblock末尾、対応NOTE_ONを次block先頭に置き、上書きが1回だけ消費されることを確認する。
6. `VOICE_PARAM` を使わない既存4プリセットのPCMゴールデンがビット一致する。
7. Workletの同一offsetで、2回の `noteOnWith()` が生成するバンドル順を保つ。種別だけの並べ替えをしない。
8. random-scale-keysの実WASMオフラインレンダーで、通常／delay／octave／順番反転を確認する。

受入基準は「センドの有無・振幅比・各音の寿命」を音ごとに検査すること。全体RMSだけでは、設定が別音へ移った誤りを検出できない。

## 比較して不採用にした案

| 案 | 不採用理由 |
|---|---|
| `VOICE_PARAM`へtarget IDフィールドを追加 | `SynthEvent` のC ABIを拡張し、M3c-3の発音ID設計まで同時に決める必要がある。今回の問題には過大。 |
| `b` floatへ対象IDを詰める | 32bit IDを正確に表せず、フィールドの意味も壊す。 |
| NOTE_ONを1サンプルずつずらす | クオンタイズした同時発音を壊し、音楽上の誤差を仕様にする。 |
| effectごとにNodeを増やす | 音色×効果のインスタンス増加を招き、M3aの共通コア化の目的に逆行する。 |

## 非対象

- 同音MIDIノートの重なりとNOTE_OFFの識別（M3c-3）。
- 取り込みログへのDSP版・プリセット固定（M3c-4）。
- 旧音源を既定に切り替えること、公開、push、リリース。
