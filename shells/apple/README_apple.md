# SynthEngine Apple shell (M0b)

Apple標準フレームワークと自作コードだけで構成した、macOS用のUIなしAUv3拡張と
AppKitスタンドアロンです。第三者ライブラリ・第三者コードは含みません。

## このMacで必要なもの

- Xcode 26.6 / macOS SDK 26.5（2026-09-04に確認）
- `/usr/bin/auval` と `/usr/bin/pluginkit`
- コード署名ID `Apple Development: YOUR NAME (YOURTEAMID)`
- Team ID `YOURTEAMID`

## ビルド

```bash
cd "/Users/arata/Library/Mobile Documents/com~apple~CloudDocs/claude code files/apps/music-plugins/synth-engine"
bash shells/apple/build.sh
```

生成物は `build/apple/SynthEngineApp.app`、内包拡張は
`Contents/PlugIns/SynthEngineAU.appex` です。スクリプトは既存ファイルを削除せず、
同名の生成ファイルだけを更新します。

### 署名で本人操作が必要な場合

このMacで2026-09-04に `security find-identity -v -p codesigning` を実行した時点では
`0 valid identities found` でした。次を本人が行う必要があります。

1. 「キーチェーンアクセス」を開く。
2. `Apple Development: YOUR NAME (YOURTEAMID)` の証明書と、展開時に表示される秘密鍵が
   ログインキーチェーン内にあることを確認する。無い場合はXcodeの Settings > Accounts >
   Manage Certificates でApple Development証明書を作成するか、秘密鍵を含む `.p12` を読み込む。
3. キーチェーンがロック中なら解除する。`codesign` 実行時に秘密鍵利用の確認が出た場合は、
   内容が上記IDであることを確認して「許可」する。
4. `security find-identity -v -p codesigning` に上記IDが1件表示された後、build.shを再実行する。

証明書・秘密鍵の作成や読み込みは本人のApple Developerアカウント／キーチェーンを変更するため、
自動では実行しません。

## AUv3登録と検証

build.shは署名後に登録と照合を実行します。成功後、続けてauvalを実行します。

```bash
pluginkit -a build/apple/SynthEngineApp.app/Contents/PlugIns/SynthEngineAU.appex
pluginkit -m -v -i com.pygmix.synthengine.au
auval -v aumu Sken Arat
```

登録に失敗する場合は、スタンドアロンを一度起動して終了し、再度 `pluginkit -m` と`auval`を実行します。

## スタンドアロン起動

```bash
open build/apple/SynthEngineApp.app
```

ウインドウを選択した状態でA〜Zを押すとノートオン、離すとノートオフを送ります。
Core MIDI入力ソースが存在する場合は起動時に全ソースへ接続します。Dockアイコンは表示しません。

発音イベントと起動状態は統合ログで確認できます。

```bash
log stream --style compact --predicate 'process == "SynthEngineApp"'
```

## Logic Pro 12.3での確認（本人確認）

1. Logic Proを終了した状態でbuild.shとauvalを完了する。
2. Logic Pro 12.3を起動し、ソフトウェア音源トラックを作る。
3. Instrumentスロットから `AU Instruments > ARATA URAWA > SynthEngine` を選ぶ。
4. MIDIノートを入力して発音を確認する。
5. Smart Controlsまたはホストのパラメータ一覧でparamId 1〜8を変更する。
6. プロジェクトを保存してLogic Proを終了し、再度開いて値が復元されることを確認する。

## アンインストール

登録解除のみ:

```bash
pluginkit -r build/apple/SynthEngineApp.app/Contents/PlugIns/SynthEngineAU.appex
```

`build/apple/` の削除はこの手順では行いません。

## 未決事項

SPEC_M0b.mdにないため、M0bでは次を暫定実装しています。

- A〜Zはアルファベット順にMIDIノート48〜73へ割り当てる。
- MIDI 1.0のノートオン／オフだけを発音へ変換し、CC、SysEx、MIDI 2.0 UMPは扱わない。
- AUParameter rampはランプ終端値をイベント開始位置で適用し、補間しない。
- AU出力は32-bit floatのmono/stereoに限定する。
- render eventは1ブロック＋持越し合計2,048件を上限とし、超過分は捨てる。
- AUコンポーネント版数は `0x00000100`（0.1.0）とする。
- 最低対応OSはmacOS 13.0とする。
- スタンドアロンの表示寸法、配色、英字キーのノート範囲は公開仕様ではない。

## 検証記録

### 2026-09-04 `bash shells/apple/build.sh`

property list検査、DSPコア、AUv3バイナリ、Swiftスタンドアロンのコンパイルとリンクは成功しました。
終了コードは70で、指定署名IDの確認段階で停止しました。全文は次のとおりです。

```text
[1/7] Validate source property lists
/Users/arata/Library/Mobile Documents/com~apple~CloudDocs/claude code files/apps/music-plugins/synth-engine/shells/apple/Info-AU.plist: OK
/Users/arata/Library/Mobile Documents/com~apple~CloudDocs/claude code files/apps/music-plugins/synth-engine/shells/apple/Info-App.plist: OK
/Users/arata/Library/Mobile Documents/com~apple~CloudDocs/claude code files/apps/music-plugins/synth-engine/shells/apple/SynthEngineAU.entitlements: OK
/Users/arata/Library/Mobile Documents/com~apple~CloudDocs/claude code files/apps/music-plugins/synth-engine/shells/apple/SynthEngineApp.entitlements: OK
[2/7] Compile DSP core for AUv3
[3/7] Build AUv3 extension
[4/7] Build Swift standalone app
[5/7] Locate signing identity
error: signing identity is not available to this process:
  Apple Development: YOUR NAME (YOURTEAMID)
Open Keychain Access, import/unlock the certificate and private key, then rerun:
  bash shells/apple/build.sh
```

指示どおり代替署名、拡張登録、`auval -v aumu Sken Arat` は実行していません。
署名IDを利用可能にした後、build.shを再実行し、その後のauval全文をこの節へ記録します。

### 表示コントラスト

`design-web/tools/contrast.mjs` による実測:

- `#1C1C1C` / `#F4F1E8`: 15.09:1
- `#474747` / `#F4F1E8`: 8.23:1
- `#7D3314` / `#F4F1E8`: 7.89:1

いずれもWCAG AA本文基準4.5:1以上です。ネイティブ画面の目視確認は署名後の起動時に行います。

## Claude の検証と修正（2026-09-04、このMac）

Codex はサンドボックス内で署名証明書を参照できず [5/7] で停止した。Claude が通常の Bash から続行し、3件を修正して完了した。

1. **ビルド先を iCloud 外へ**: iCloud 配下だと `codesign` が「resource fork, Finder information, or similar detritus not allowed」で失敗。
   既定を `~/build/synth-engine/apple/`（`SYNTH_BUILD_DIR` で上書き可）にし、署名前に `xattr -cr` を追加。
2. **拡張の実行形式**: `-bundle`（MH_BUNDLE）でリンクされていたため entitlements が署名に乗らず pluginkit に登録されなかった。
   `-e _NSExtensionMain -fapplication-extension` の実行形式（MH_EXECUTE）へ変更 → 登録成功。
3. **fullState**: auval「Class Data does not have required field:<type> == componentType」。`[super fullState]` を土台にし、
   `setFullState:` で `[super setFullState:]` を呼ぶよう変更。

結果: `auval -v aumu Sken Arat` → **AU VALIDATION SUCCEEDED**（警告1件: CurrentPreset deprecated → `PresentPreset` 実装は後段）。
open 時間 542 ms／108 ms。スタンドアロンは起動を確認（プロセス稼働）。Logic Pro 12.3 での読込・保存復元は本人確認待ち。
