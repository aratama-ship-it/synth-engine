# SPEC M0b — AUv3＋スタンドアロン（Apple標準フレームワークのみ）

対象: `apps/music-plugins/synth-engine/shells/apple/`（新規）。前提: `core/`（M0a 完了・C ABI は `core/include/synth_engine.h`）。
第三者ライブラリ（JUCE 等）・第三者コードのコピーは禁止。Apple のフレームワーク（AudioToolbox / AVFoundation / AppKit / CoreMIDI）と自作コードのみ。

## 識別子（暫定・本人未確定。公開前に変更可）

- AU タイプ `aumu`、サブタイプ `Sken`、製造者 `Arat`。製品名 `SynthEngine`（仮）、製造者名 `ARATA URAWA`
- Bundle ID: アプリ `com.pygmix.synthengine`、拡張 `com.pygmix.synthengine.au`
- 署名: このMacの証明書 `Apple Development: YOUR NAME (YOURTEAMID)`（Team ID YOURTEAMID）。アプリと拡張は同じ Team ID
- バージョン: `0.1.0`（`CFBundleShortVersionString`）。画面左上に `v0.1.0` を表示（全開発共通ルール）

## 作るもの

1. **SynthEngineAU.appex**（AUv3、macOS）
   - `AUAudioUnit` サブクラス（ObjC++ `.mm`、`core/src/engine.cpp` `wavetable.cpp` を直接コンパイルしてリンク）
   - `internalRenderBlock` で `synth_process` を呼ぶ。`AURenderEvent` のリスト（MIDI note on/off、parameter）を `SynthEvent` に変換。
     ブロック内オフセット = `event.eventSampleTime - timestamp->mSampleTime`（0 未満は 0、nFrames 以上は次ブロックへ持ち越し）
   - `maximumFramesToRender` に合わせて `synth_create(…, maxBlock)`。`allocateRenderResources` で state を確保、`deallocateRenderResources` で解放。
     render 中はアロケーション・ロック・ObjC メッセージ送信をしない
   - `AUParameterTree`: paramId 1〜8（`SPEC_M0a.md` の表）を `AUParameter` として公開。値変更は非RTで `synth_set_param` → 次ブロックから反映
   - `fullState` / `fullStateForDocument` に全パラメータ値を保存・復元（PatchState 相当）
   - `Info.plist` の `NSExtension`: `NSExtensionPointIdentifier = com.apple.AudioUnit-UI` は使わず `com.apple.AudioUnit`（UI無し）で可。
     `AudioComponents` に type/subtype/manufacturer/name/version/`sandboxSafe=true`/`tags=[Synthesizer]`
   - macOS の拡張は App Sandbox 必須（entitlements `com.apple.security.app-sandbox`）。プロビジョニングプロファイル不要の範囲で組む
2. **SynthEngineApp.app**（スタンドアロン、Swift、AppKit）
   - 拡張を `Contents/PlugIns/SynthEngineAU.appex` に内包。起動時に `AVAudioUnit.instantiate(with:)` で自分の AUv3 を `AVAudioEngine` に挿して出力へ接続
   - PCキーボード A〜Z で発音（配列は US/JIS で共通な英字だけ）。Core MIDI 入力があれば受ける（`MIDIClientCreate`、無ければ省略可）
   - ウインドウ左上に `v0.1.0`、バッファサイズとサンプルレートを表示。Dock アイコンは不要
3. **ビルド**: `shells/apple/build.sh`（`xcodebuild` を使う Xcode プロジェクト、または `swiftc`/`clang++`＋バンドル手組み＋`codesign` のどちらでもよい。
   **検証コマンドで再現できる方**を選ぶ）。生成物は `build/apple/` へ。
   - `pluginkit` またはアプリの初回起動で拡張を登録し、`auval -v aumu Sken Arat` が走る状態にする
4. **README_apple.md**: ビルド・登録・auval・Logic での使い方・アンインストール（`pluginkit -r`）を、このMac固有の点を明示して書く

## 完了条件（M0 合否基準 1）

- `bash shells/apple/build.sh` が成功し `build/apple/SynthEngineApp.app` ができる
- `auval -v aumu Sken Arat` が `AU VALIDATION SUCCEEDED`（警告は README に記録）
- スタンドアロンを起動して A〜Z で音が出る（Claude はヘッドレスで音を聴けないので、`log` に発音イベントを出す）
- Logic Pro 12.3 での読込・保存復元は**本人が確認**（README に手順）

## やらないこと

- GUI（ノブ等）、プリセットブラウザ、AUv2、iOS。ファイルの削除・移動はしない。`core/` は編集しない（不足があれば README の未決事項に書く）
