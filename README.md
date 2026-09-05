# synth-engine

ウェーブテーブル・シンセサイザーを、**第三者ライブラリを1行も使わずに**ゼロから作っています。
ひとつの C++ コアを、**AUv3 プラグイン（Logic Pro などで使う）／macOS スタンドアロン／ブラウザ（WebAssembly + AudioWorklet）**の
3つの殻から鳴らします。

```
                    ┌──────────────────────────────────────────┐
   Logic Pro   ───▶ │ AUv3 (AudioToolbox / AUAudioUnit)        │
   スタンドアロン ─▶ │ AVAudioEngine で自分の AUv3 をホスト       │──┐
   ブラウザ    ───▶ │ wasm32 + AudioWorkletProcessor           │  │
                    └──────────────────────────────────────────┘  │
                                                                   ▼
                    ┌──────────────────────────────────────────────────────┐
                    │ core/  C++20 DSPコア                                  │
                    │  ・標準ライブラリにも依存しない（stddef.h / stdint.h のみ） │
                    │  ・動的確保なし・例外なし・ブロック処理・C ABI           │
                    │  ・SVF、EG2、LFOを含め同じ入力から同じサンプルが出る       │
                    └──────────────────────────────────────────────────────┘
```

## なぜ全部自分で書いているか

音の部品を配っている優れた C++ ライブラリはありますが、多くは GPL 系で、使うと配布側に義務が生じます。
JUCE も AGPL か商用ライセンスの二択です。**ライセンスの都合で後から動けなくなるのを避けたい**ので、
リンクして配布物に入るコードは全部自分で書くことにしました。
公知のアルゴリズム（SVF、ADSR、加算合成によるミップマップなど）は自分で実装しています。
コンパイラやビルドツールは配布物に入らないので、そこは普通に使います。

## いまできること

| | 状態 |
|---|---|
| DSPコア | 2オペのウェーブテーブル OSC、ユニゾン最大4声、B→A の位相変調（FM）、サブ、white/pink ノイズ、波形モーフ、TPT/ZDF SVF、ディケイ／リリースのカーブを選べるアンプ／フィルタEG、6波形LFO |
| AUv3 プラグイン | `auval` 警告0で通過。パラメータ、状態保存、ファクトリープリセット |
| スタンドアロン | 起動して A〜Z キーで演奏できる |
| ブラウザ | AudioWorklet でライブ演奏、OfflineAudioContext でオフライン書き出し |
| フィルタ | 12/24 dB の SVF（LP/BP/HP/Notch）、キートラック、専用エンベロープ |
| LFO | 6波形、フリーラン／ノートで頭出し、カットオフ・ピッチ・音量へ直結 |
| モジュレーションマトリクス | **まだありません**（次の段階）。AU と Web から触れるのも当面パラメータ 0〜8 のみ |

## 実測値（Apple M4 Pro / macOS 26.5.2）

3つの殻が本当に同じ音を出しているかを、毎回数値で確認しています。

| 測定 | 結果 |
|---|---|
| **AU と CLI の出力** | **ビット一致**（ベロシティが MIDI の7bitで表せる値のとき） |
| **wasm と native の差（M0基準）** | 最大 −133.6 dBFS ／ RMS −162.2 dBFS |
| ブロックサイズ不変性 | block 1／7／64／128／511 でビット一致 |
| サンプルレート | 44.1／48／96 kHz すべてで NaN・Inf ゼロ |
| 処理時間 | LP24・LFO・16音 × ユニゾン4で平均 167 µs・p99 216 µs（48 kHz / 128 frames、期限の50%は1333.5 µs） |
| エイリアス | ノコギリ波 C8 で −96.2 dB、FM 全開で −94.3 dB |
| フィルタ | −3 dB点の最大誤差 0.342%、LP12 −11.94 dB/oct、LP24 −23.88 dB/oct、resonance 0.8 のピーク差 +13.82 dB、キートラック 1oct で 2.003 倍 |
| 共振の実挙動 | resonance 1（Q=100）でカットオフ周波数にリンギングし 136 dB/秒 で減衰。**理論値と一致**（持続的な自己発振はしない） |
| LFO | 6波形とも周期誤差 0%、S&H再レンダーはビット一致。設定 5 Hz で明るさが実測 毎秒 5.0 回変化 |
| wasm サイズ | 28,452 バイト（gzip 9,198 バイト・import 0） |
| 自動テスト | 38項目すべて PASS |

## 動かす

必要なもの: Xcode（clang / swiftc）、GNU make、Node.js。WASM を作るなら `brew install llvm lld`。

```bash
make test                 # コアの自動テスト38項目
make cli                  # オフラインレンダラー
./build/render-cli --preset presets/m1_unison_saw.txt --events fixtures/m0_events_chord.txt \
    --out build/out.wav --sr 48000 --block 128 --frames 96000

./build/render-cli --preset presets/m1b_filter_sweep.txt --events fixtures/m0_events_chord.txt \
    --out build/m1b_filter_sweep.wav --sr 48000 --block 128 --frames 96000

./build/render-cli --preset presets/m1b_sweep_linear.txt --events fixtures/m0_events_chord.txt \
    --out build/m1b_sweep_linear.wav --sr 48000 --block 128 --frames 96000

make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang   # build/synth_engine.wasm

bash shells/apple/build.sh    # AUv3 + スタンドアロン（署名IDは自動検出）
auval -v aumu Sken Arat       # AU の検証

node tools/serve.mjs          # ブラウザ版 → http://127.0.0.1:8963/shells/web/demo.html
```

詳しくは [docs_BUILD.md](docs_BUILD.md)（コアの入出力形式・テスト項目・未決事項）、
[shells/apple/README_apple.md](shells/apple/README_apple.md)（AUv3 の作り方と落とし穴）、
[shells/web/README_web.md](shells/web/README_web.md)（AudioWorklet 側）。

## 構成

```
core/         DSPコア（C ABI。ここだけで音が決まる）
shells/apple/ AUv3 拡張 + スタンドアロン（Apple のフレームワークのみ）
shells/web/   AudioWorkletProcessor + デモページ（自前ローダのみ）
tools/        オフラインレンダラー、AU と CLI の突き合わせ、確認用サーバー
tests/        自作の検証ハーネス（テストフレームワーク不使用）
presets/      プリセット（1行1パラメータのテキスト）
fixtures/     イベント列（絶対フレーム位置つき）
```

## この先

1. AU/Webへフィルタ・EG2・LFOのパラメータを公開
2. モジュレーションマトリクスとマクロ
3. 別プロジェクト [random-scale-keys](https://github.com/aratama-ship-it/random-scale-keys) の音源をこのシンセに差し替える

## 開発中に踏んだ落とし穴（macOS で AUv3 を自作する人へ）

- **App Extension は `-bundle` でリンクしてはいけない。** `-e _NSExtensionMain -fapplication-extension` の実行形式にしないと
  entitlements が署名に乗らず、`pluginkit` に登録されない。
- **`fullState` は `[super fullState]` を土台にする。** 自前の辞書だけ返すと `auval` が
  「Class Data does not have required field: componentType」で落ちる。
- **iCloud Drive 上のファイルは扱えない。** 同期属性のせいで `codesign` が
  「resource fork, Finder information, or similar detritus not allowed」で失敗し、
  さらに **iCloud 上に置いた実行ファイルからは AUv3 を読み込めない**（`NSOSStatusErrorDomain -1`。同じバイナリを別の場所に置くと成功）。
  そのためビルド生成物は `~/build/` に出しています。
- **AudioWorkletGlobalScope に `performance` が無い環境がある。** `Date.now()` へのフォールバックが要る。
- **AU と CLI の出力が一致しないと思ったら MIDI の7bitだった。** ベロシティ 0.8 は 102/127 = 0.80315 になり、
  信号比 −48 dB の差として現れます。実装の誤りではありません。

## ライセンス

**未定です。** 現時点では LICENSE ファイルを置いていないため、法的にはすべての権利が留保された状態です
（読むこと・学ぶことはご自由に。再利用や再配布の可否は決まり次第ここに書きます）。

第三者のコードは含んでいません。ビルドに使う Apple のフレームワークと LLVM は、配布物にリンクされる形では含まれていません。
