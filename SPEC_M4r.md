# M4r — Session-only Custom Wavetable WAV import

## Goal

OSC A/Bで共有する1つのCustom Wavetable枠へ、ユーザーがローカルWAVを読み込み、
既存のmip-safe wavetable経路で試奏できるようにする。録音素材から周期を推定する機能、
256フレーム互換、編集、永続保存はこの段階に含めない。

## Input contract

- RIFF/WAVE、PCM 16/24/32-bitまたはIEEE float 32-bit
- mono/stereo（stereoはL/R平均）
- 8,000〜384,000 Hz、2 MiB以下
- 2048 samples × 1〜4 frames（合計2048〜8192 samples）
- フレームごとにDC除去し、peakを0.95へ正規化
- 無音・一定値・NaN・Inf・不正チャンク・曖昧な長さは拒否

## Core contract

- slot 0〜3は既存の内蔵4テーブルを維持し、slot 4をCustomとする
- Custom未読込時はsine 1フレームで安全に初期化する
- `synth_load_wavetable()`は全入力を先に検証し、失敗時に既存slotを変更しない
- 読込後は10段mipを生成し、全mipの絶対peakを0.95以下に制限する
- selector ID 0 / 17の範囲を0〜4へ広げ、既存ID・C ABI・113パラメータを維持する
- engine versionは16

## Web and safety contract

- `CUSTOM WT / LOCAL WAV · SESSION ONLY`をOSC A/Bの直前に1本だけ表示する
- 読込前に全ノートを停止し、出力ゲートを閉じ、Workletでもvoice resetとevent ring clearを行う
- 読込後も自動発音・自動selector変更・出力ゲート再開を行わない
- 音声データをlocalStorage、パッチJSON、外部ネットワークへ保存・送信しない
- Custom未読込の状態でslot 4を選ぼうとした場合は現値へ戻す
- Customを参照するパッチを音声データのないセッションで復元した場合はBasic Shapesへ戻し、画面で通知する
- 読込失敗時は直前のCustom波形を保持する

## Validation

- core 72 tests: Custom初期値、2-frame読込、全mip有限性／peak、selector範囲、非破壊拒否
- Web 65 tests: WAV解析、stereo平均、厳密長、Node/Worklet転送、slot 4での無音安全ゲート
- 物理出力へ接続しない安全試験の上限はpeak 0.25、release/panic後は1e-7以下
- UIは390/1280/1440pxで横溢れ、44px操作面積、console errorを確認する
