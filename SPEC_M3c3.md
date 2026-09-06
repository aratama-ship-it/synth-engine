# SPEC M3c-3 — 同音連打を発音ハンドルで終了する

Status: **実装済み・ローカル自動検証済み**。M3c-2の`VOICE_PARAM* → NOTE_ON`バンドル契約は前提として維持する。この仕様は、同じMIDI音高を重ねた発音を個別に終了できるようにするWeb APIとrandom-scale-keysの境界だけを扱う。

## 問題

現行Web APIは`noteOn(60)`と`noteOff(60)`の`60`を、そのまま`SynthEvent.id`へ入れる。コアは`id`が同じ発音を同じvoiceとして扱うため、同じC4を重ねると二つ目が一つ目を上書きする。さらに一つ目のNOTE_OFFが二つ目もreleaseへ入れる。

現行WASMを使うプローブでは、0/128 frameで同じIDを発音し256/768 frameで順に終了した場合、二つ目だけが残るべき区間のRMSは0だった。異なるIDでは同区間RMSは0.49063632170192867だった。

## 採用する契約: 不透明な発音ハンドル

`noteOn()`と`noteOnWith()`は、発音ごとに一意な`NoteHandle`を返す。`noteOff()`はMIDI音高ではなく、そのハンドルだけを受け取る。

```js
const c4a = synth.noteOn(60, 0.8, frame);
const c4b = synth.noteOnWith(60, 0.7, [[75, 1]], frame + 128);
synth.noteOff(c4a, frame + 256); // c4bは鳴り続ける
synth.noteOff(c4b, frame + 768);
```

- `NoteHandle`は各SynthNodeが作る不透明なオブジェクトであり、MIDI音高と交換できない。
- 内部の`id`は1から`0xffffffff`まで単調増加する32-bit発音ID。0は使わない。
- 上限に達した場合は再利用せず、ノードの再生成を求める例外で停止する。衝突を隠して別音を止めない。
- `noteOff(60)`のような旧形式はTypeErrorで明示的に拒否する。MIDI番号と発音IDを曖昧に解釈しない。
- `sendEvents()`は低水準APIとして残る。この経路の呼び出し側は`NOTE_ON` / `NOTE_OFF`へ一意な`id`を明示する。
- C ABIの`SynthEvent`（20 byte）とcoreのvoice選択・NOTE_OFF処理は変更しない。coreに渡す`id`の意味を「MIDI音高」から「発音インスタンスID」と文書化する。
- `synth_engine_version()`は8のままとする。WASM DSPの計算・C ABIに変更はなく、Web Node APIの契約変更のみである。

## 対象境界

| 層 | 変更 | 維持するもの |
|---|---|---|
| Web Node API | ハンドル生成、`noteOn*`の返値、`noteOff(handle)`の検証 | Workletメッセージ、2出力、M3c-2バンドル順 |
| Webデモ / selftest | 発音ハンドルをkeyごと・試聴ごとに保存してrelease | MIDI音高、UI、時刻原点 |
| random-scale-keys | `scheduleSingle()`が返値を保存し、通常・octave・stutter・arpeggio・holdを各ハンドルで終了 | 旧音源既定、ログ形式、URL切替、DSPプリセット |
| C++ core | 同音・別IDの寿命を回帰テスト化 | `SynthEvent`、voice上限、voice stealing、AU経路 |

AUのMIDI channel + noteによるIDと、CC64（サステイン）の規則は本仕様の対象外。MIDI入力として必要になったとき、別仕様でnote stackとペダルを定義する。

## 受入条件

1. 同じMIDI 60を異なるIDで0/128 frameにNOTE_ONし、256/768 frameに個別NOTE_OFFしたとき、384..640 frameに二つ目が残る。
2. 同じ入力をblock 1/7/64/128/511でレンダーしてPCMが一致する。
3. Node APIの二つの`noteOnWith(60, ...)`が異なる不透明ハンドルと異なるevent.idを出し、各`noteOff(handle)`が対応IDを送る。
4. 数値MIDIを`noteOff()`へ渡す旧形式は例外で拒否する。
5. random-scale-keysのstutter、hold、同時octaveを実Worklet + 同梱WASMでレンダーし、各NOTE_OFFが対応する発音IDだけを終了する。
6. M3c-2の同時VOICE_PARAMバンドル、既存PCMゴールデン、16voice上限、旧音源経路を回帰する。
7. ID上限では黙って0または既存IDへ戻らず、発音を開始しない。

## 不採用案

| 案 | 不採用理由 |
|---|---|
| MIDI音高をNOTE_OFFのまま残し、同じ音を全て止める | 長さの異なる同音やholdを正しく表せず、現行不具合を残す。 |
| APIへ任意の数値IDを毎回渡させる | random-scale-keysと通常のWeb利用で衝突管理を呼び出し側へ押し付ける。 |
| NOTE_ONを1サンプルずらす | 同時発音の時間を改変しても、NOTE_OFFの識別問題は解決しない。 |
| C ABIへMIDI音高と発音IDを別フィールドで追加 | ABIを広げる必要がない。音高はすでに`a`、発音IDはすでに`id`にある。 |

## 非対象

- AU MIDIの同音連打・サステインペダル・pitch bend。
- 録音ログへのDSP版／プリセット固定（M3c-4）。
- 旧音源の既定切替、公開、push、リリース。
