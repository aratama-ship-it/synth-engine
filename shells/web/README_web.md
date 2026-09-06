# SynthEngine Web shell (M3b-1)

`build/synth_engine.wasm` の DSP コアを、第三者 JavaScript ライブラリなしで `AudioWorkletProcessor` から駆動する検証用 Web shell。

## 起動

このプロジェクトの直下で次を実行する。

```sh
make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang
python3 -m http.server 8963
```

Chromium 系ブラウザで次を開く。

<http://localhost:8963/shells/web/demo.html>

通常の音色編集と演奏は、次の独立した画面を使う。既存の検証用`demo.html`はそのまま残す。

<http://localhost:8963/shells/web/synth.html>

`file://` では AudioWorklet と相対 `fetch` の確認ができないため、必ず HTTP で配信する。

## Web Synth UI

`synth.html`は、EPiano / Saw / Pluck / Bellに加え、Wide Pad / Warm Bass / Glass Bell / Bright Pluck / Motion Lead / Air Keysを起点に、OSC A、OSC B / MIX、FILTER、AMP ENVELOPE、LFO / MACRO、FX BUS、DELAY、REVERBを音の流れで編集する通常のシンセ画面である。PCキー`A W S E D F T G Y H U J K`または画面鍵盤の最初の操作で音源を開始し、そのまま演奏できる。プリセットを選ぶと全76パラメータを既定値へ戻してから当該音色を読むため、直前の音色設定は混ざらない。主要パラメータは直ちに`setParam()`へ送られ、残りのDSPパラメータは「詳細設定」に畳んでいる。

FX BUSはコアのsend出力だけを受けるWeb Audioの入口である。その先は並列の`DELAY`と`REVERB`へ分かれ、各モジュールの`SEND`で入力を独立して止められる。`DELAY`は`MIX`と80〜720 msの`TIME`を持ち、初期値の`SEND`は0なので、INITでは反復エコーを鳴らさない。`REVERB`は`SEND`、`MATERIAL`、`MIX`を持つ。`CLEAR`は明るく密な既定残響、`WARM`は高域を抑えた長い残響、`GRAIN`は短く疎らな反射である。dry出力は従来どおり直接出力される。低域の濁りを避けるため、FX BUSの入口を120 Hzでハイパスしている。

このUIはWeb殻だけの追加であり、DSP/C ABI/WASM、AU、スタンドアロン、random-scale-keysの既定経路を変更しない。設計メモと数値トークンは`design/SYNTH_UI_DESIGN.md`、`design/SYNTH_UI_TOKEN_SHEET.md`に置く。

## 確認手順

1. 画面左上に `v0.1.0`、状態欄に「準備完了」と出ることを確認する。
2. 「開始」を押し、A〜Z キーを押している間だけ発音することを確認する（A=60、アルファベット順に半音上昇）。
3. 「音符ごとの上書きを試す」を押し、同じ3音のうち2音目だけ明るいことを確認する。
4. 「センドを試す」を押し、同じ3音のうち2音目だけディレイ付きになることを確認する。
5. 「オフライン10秒レンダー」を押す。
6. `synth-engine-web-10s.wav` が生成され、画面の `nan` が 0 になることを確認する。
7. native 比較が最大 −100 dBFS 以下、RMS −120 dBFS 以下であることを確認する。
8. WASM サイズ、batch ready、`process()` の average / p99 が画面に出ることを確認する。性能値は直近最大1000ブロックを対象にし、100ブロックごとに更新する。

## M3c-3 API

```js
const frame = Math.ceil(context.currentTime * context.sampleRate);
const note = synth.noteOnWith(60, 0.8, [[37, 4000], [75, 1]], frame);
synth.noteOff(note, frame + Math.round(context.sampleRate * 0.3));

synth.connect(context.destination);          // 既定どおり dry（出力0）
synth.connect(delayInput, synth.sendOutput); // sendOutput は出力番号1
// 上と同じ指定: synth.connect(delayInput, 1)
```

`noteOn()`と`noteOnWith()`は発音ごとに不透明な`NoteHandle`を返す。`noteOff()`はMIDI音高ではなく、この同じNodeが返したhandleだけを受け付ける。これにより同じC4を重ねても、一方だけを個別に終了できる。数値の`noteOff(60)`、別Nodeのhandle、ID空間が尽きた後の発音は例外で拒否する。低水準の`sendEvents()`は残るが、呼び出し側がNOTE_ON/OFFの一意な`id`を管理する。

同時発音で音符ごとの設定を結ぶ正規入口は`noteOnWith()`である。これは同一`frame`の`VOICE_PARAM* → NOTE_ON`を一つの`events`メッセージとして送る。MessagePortへ直接送る低水準APIは`{type:"voiceParam", params:[[id, value], ...], frame?}`を使えるが、すでに送った同時フレームのNOTE_ONへは遡及しない。`frame`省略時はWorkletが次に処理するブロックの先頭へ置く。`{type:"events"}`と`batch`のイベント配列も`kind:5`を受け付け、同一フレームでは入力配列の順序を保持する。

ライブのフレーム時刻は `AudioWorkletGlobalScope.currentFrame` を正本にする。呼び出し側は
`Math.ceil(context.currentTime * context.sampleRate)` で同じ AudioContext の絶対フレームを送り、
Workletを後から生成しても時刻原点はずれない。Node上の検査では `currentFrame` が無いため、
Worklet内部カウンタへフォールバックする。

`connect(destination, outputIndex = 0)`の第2引数は省略可能であり、従来の`connect(destination)`はdry出力へ接続する。

単体テスト:

```sh
node --test shells/web/tests/
```

WASM と native CLI の Node 比較:

```sh
node tools/wasm-check/compare.mjs build/synth_engine.wasm presets/m0_saw.txt fixtures/m0_events_chord.txt build/out.wav 48000 128 96000
```

VOICE_PARAMとdry/send出力をCLIとビット比較:

```sh
node tools/web-voiceparam-check.mjs
```

`render-cli`は通常の`--out FILE`に加え、必要な場合だけ`--send-out FILE`でステレオFloat32 WAVのセンド出力を書き出せる。

## 実測値

| 項目 | 値 | 環境・備考 |
|---|---:|---|
| WASM raw | 49,898 B | `wc -c build/synth_engine.wasm`、2026-09-06実測 |
| WASM gzip | 15,047 B | `gzip -c build/synth_engine.wasm \| wc -c`、2026-09-06実測 |
| batch `ready` | ブラウザ確認後に記録 | Worklet 内 `WebAssembly.instantiate` 開始から batch 適用可能になるまで |
| `process()` average | ブラウザ確認後に記録 | `performance.now()`、直近最大1000ブロック |
| `process()` p99 | ブラウザ確認後に記録 | 同上 |
| peak / rms / nan | ブラウザ確認後に記録 | 48 kHz、10秒、2ch |
| native 最大差 / RMS差 | −133.61 / −162.25 dBFS | Node、96,000フレーム、左ch、2026-09-04実測。NaN 0 |

## 実装上の固定事項

- Worklet は `processorOptions.wasmBytes` だけを受け取り、Worklet 内では `fetch` しない。
- `__heap_base` 以降に state、4096イベント分、dry左右、send左右（各最大512フレーム）を16-byte境界で配置する。不足時だけ初期化中に `memory.grow` する。
- オフライン batch は `reset(ALL) → preset → reset(VOICES) → events` の順で投入する。`reset(ALL)` がパラメータを初期値へ戻すため、この順序を崩さない。
- エラー時は MessagePort へ `{type:"error"}` を送り、出力を無音に保つ。

## 画面設計メモとデザイントークン

対象は DSP 実装者がローカルで合否を短時間に確認する一画面。主役は装飾ではなく開始操作と数値結果で、計測器に近い高密度・等幅表示を採用した。一般的な製品ランディングページのヒーロー、カード装飾、演出は使わない。キーボード操作、結果、性能を同じ画面で追え、狭い画面では1列になることを機能条件とした。

| 種別 | トークン |
|---|---|
| 配色 | bg `#11130f`、panel `#1b1e18`、line `#3e4436`、text `#f2f0e7`、sub `#b9beac`、accent `#d7ff4f`、error `#ff8e7a` |
| コントラスト実測 | text/bg 16.37:1、sub/bg 9.81:1、accent/bg 16.29:1、text/panel 14.77:1、sub/panel 8.85:1 |
| 書体 | OS 等幅 (`ui-monospace`)、本文15px/1.55、見出し30px/1.1、注釈12px |
| 余白 | 4 / 8 / 16 / 24 / 40px、最大幅960px、2列、680px以下は1列 |
| 形状 | 角丸3px、1px罫線、影なし、操作高48px |
| モーション | なし（`prefers-reduced-motion` に依存する演出なし） |

## 未決事項

SPEC M0c / M3b-1 に規定がなく、製品仕様としては未確定の事項。括弧内は現在の暫定挙動。

- リアルタイムイベントの先読み量と遅延許容値（現在は `AudioContext.currentTime` から得たフレームを送り、到着済みの過去イベントは次ブロックの offset 0 に丸める）。
- リング満杯時の復旧方針（現在は batch を部分投入せず error にして以後無音）。
- reset の seed と reset 後に予約イベントを残すか（現在は seed=1、予約イベントは破棄）。
- 同じ MIDI note の重複キー入力を別 noteId にするか（現在は note 番号を noteId に使い、キーリピートを無視）。
- `ready` の定義へモジュール取得時間を含めるか（現在の画面値は Worklet 内 instantiate 時間のみ）。
- `process()` 統計の通知間隔（現在は100ブロックごと）。
- native 比較を左右両chで行うか（現在は、コアがステレオ同一である M0a 仕様に基づき左chのみ）。
- オフライン sample rate を端末値へ合わせるか（現在は fixture / native CLI と比較可能な48 kHz固定）。
- ライブ Worklet 初期化完了を専用メッセージで通知するか（現在はエラーだけ通知し、batch のときだけ `ready` を返す）。
- AudioWorkletNode の明示的な終了・再生成 API（現在はページの AudioContext のライフサイクルに従う）。
- `sendOutput` getterの返却型（SPEC M3b-1は型を規定していないため、現在は`connect(destination, outputIndex)`へ渡せる出力番号`1`を返す）。

2026-09-06にヘッドレスChromiumで、新しい2操作の完了、10秒オフラインレンダー、WAVダウンロード、nativeビット一致、page error 0、デスクトップ/390px幅の描画を確認した。確認音の「2音目だけ明るい／ディレイ付き」という聴感差は人の耳では未確認。

## Claude の実機検証（Chromium、2026-09-04）

- 開始→A キー発音 OK（48,000 Hz）。オフライン10秒レンダー OK。native 差: 最大 −133.61 dBFS／RMS −162.25 dBFS。nan 0。
- 修正: Worklet 内で `performance` が未定義だったため `nowMs()`（Date.now フォールバック）に変更。p99 表示は 1 ms 刻みになる。
- Safari は未検証（本人確認待ち）。
