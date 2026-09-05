# synth-engine（仮称）— 自作シンセサイザー PROJECT_NOTES

- 発足: 2026-09-04（Claude Fable × Codex gpt-5.6-sol の2往復ブレストで設計を収束）
- 状態: **D1〜D6 承認済み（2026-09-04）。M0a 実装中（Codex委譲）**。追加条件: ライセンス対応を避けるため**第三者コードをリンクしない**
- ★**`design/` は公開リポジトリに含めない**（`.gitignore`）。判断用HTML・ブレスト生ログ・夜間レポート・試聴ページは手元だけ。
  GitHub から読む人にとって以下の `design/...` へのリンクは辿れない。
- 判断用HTML（正本・手元のみ）: `design/DESIGN_PLAN_2026-09-04.html`
- ブレスト記録: `design/brainstorm/`（Claudeの問い2本・Codexの回答2本の生ログ）と
  `obsidian-vault/ideas/2026-09-04_自作シンセ設計_Claude×Codexブレスト.md`
- このファイルは別マシンのエージェントが単体で読んで引き継げるよう自己完結的に書く

## 目的

random-scale-keys（`apps/music-plugins/random-scale-keys/`）の音源を差し替えるところから始め、
同じDSPコアを **macOSスタンドアロン／AUプラグイン（Logic Pro）／Webアプリ（AudioWorklet）** で鳴らす。
Serumの全機能再現は目的ではない。「Serum型の構成で、今ある4音色（epiano/saw/pluck/bell）を覆える最小の音源」を先に完成させる。

## 本人決定（2026-09-04）

- D1〜D6 すべて承認。ただし「ライセンスが面倒なので、できる限り1から自作」→ **JUCE と Emscripten を外す（A″）**
- 殻は Apple標準フレームワークのみ: AUv3（AudioToolbox `AUAudioUnit`、Swift/ObjC）＋スタンドアロン.app（AVAudioEngine で自分のAUv3を内包・ホスト）
- WASM は Homebrew LLVM の clang で `--target=wasm32 -nostdlib`。ローダJSは自前。配布物に第三者コードが入らない
- コア `core/` は標準ライブラリにも依存しない（fast_math 自作）。詳細は `SPEC_M0a.md`
- ツール（clang、Homebrew LLVM、make、Xcode、node）は制約にならない。**リンクして配布物に入るコードだけを問題にする**

## 設計の骨子

- **アーキ A″**: フレームワーク非依存の C++20 DSPコア（`core/`、実行時アロケーション無し・例外無し・標準ライブラリ非依存・ブロック処理・C ABI）
  ＋ Apple殻（AUv3＋スタンドアロン、Apple標準のみ）＋ WASM殻（clang wasm32 freestanding、AudioWorkletProcessor 1ノード）。
  ブレスト時の A′（JUCE＋Emscripten）はライセンス回避の本人条件で取り下げ。iPlug2・Cmajor も同じ理由で不採用
- **エンジンモデル**: 決定論的状態機械 `(初期状態 + サンプル位置付きコマンド列) → PCM + 終了状態`。
  乱数は消費順非依存 `hash(seed, eventId, voice, layer)`、float化も明示変換で固定
- **C ABI**: イベント一括投入型 `synth_process(events[], n, outL, outR, nFrames)`。イベントはブロック内オフセット、
  絶対フレームは殻側。同一サンプルの順序は noteOff → param → noteOn。state は `PatchState`（プリセット・AU保存）と
  `RuntimeCheckpoint`（ボイス位相・EG・FX・RNG。オフライン再開専用）に分ける。ログ再生は必ず reset から
- **音源構成（MVP）**: WT OSC A/B（モーフ、ユニゾン≤4、BがAをFM/PM）＋サブ＋ノイズ、SVF×1、EG×2、LFO×1、
  モジュレーション6スロット、マクロ×2（1つは random-scale-keys の緊張度T）、16音固定・voice stealing・CC64・平滑化。
  FX（サチュレーション/ディレイ/小型リバーブ）は**ボイスエンジンと分離**。ドライ出力とFXセンド出力を別に持つ
- **「同じ音」の境界**: Web と AU で一致させるのは**ドライPCMまで**。Web側は既存バス（主リバーブ200Hz HP・SFX部屋・コンプ）を使う
- **プリセットJSON**: schemaVersion / engineVersion / 安定param id / WTハッシュ。random-scale-keys のイベントログに同梱
- **ウェーブテーブル**: 内蔵（基本波形＋生成物）のみ同梱。Serum互換WAVインポートは後段の隔離モジュール。素材は再配布しない

## ライセンスの事実（2026-09-04 GitHub API／READMEで確認）

- Surge系 `sst-filters` `sst-waveshapers` `sst-effects` `sst-basic-blocks` = **GPL-3.0**（MITではない。流用しない）
- JUCE = AGPLv3 または商用。Web版WASMはJUCEを含まない
- nih-plug 本家 = maintenance mode、書き出しは VST3/CLAP のみ。iPlug2 = zlib系、AUv2/AUv3/WAM 対応
- Cmajor = GitHub API では NOASSERTION（要確認）

## マイルストーン（目安）

M0 縦切りスパイク（約2週・ゲート。M0a=コア＋CLI＋テスト／M0b=AUv3＋スタンドアロン／M0c=wasm32＋AudioWorklet）→ M1 ボイスエンジン＋CLIレンダラー＋自動テスト（約3週）→
M2 4音色プリセット＋本人A/B（約2週・耳ゲート）→ M3 random-scale-keys組込（約2週。ここで「使える」）→
M4 AU仕上げ（約3週）→ M5 拡張。M0の合否基準5項目はHTMLに記載（閾値は暫定）。

## 環境（このMacで 2026-09-04 実測）

- あり: Xcode 26.6、Apple clang 21、`/usr/bin/auval`、Logic Pro、node v22.17.0、Homebrew
- Apple clang は wasm32 非対応（実測）→ `brew install llvm`（2026-09-04 導入。`/opt/homebrew/opt/llvm/bin/clang`、wasm-ld 同梱）。cmake/emsdk/JUCE は不要
- コード署名: `Apple Development` 証明書あり（AUv3拡張のローカル署名用。build.sh が自動検出）。Logic Pro 12.3
- ソースはこのフォルダ。ビルド成果物は iCloud外 `~/build/synth-engine/`。git は `--separate-git-dir ~/git-repos/synth-engine`
- Claude は音を聴けない。検証は CLIレンダラー基準の差分・FFT・NaN・性能まで。好みのゲートは本人の耳

## WASM ツールチェーン（このMacで 2026-09-04 実測・動作確認済み）

- `brew install llvm lld`（llvm は keg-only。lld は別formula。`/opt/homebrew/opt/llvm/bin/clang` = Homebrew clang 23.1.0）
- ビルド例（freestanding、第三者コード無し）:
  `/opt/homebrew/opt/llvm/bin/clang --target=wasm32 -nostdlib -O2 -fuse-ld=lld -B/opt/homebrew/opt/lld/bin -Wl,--no-entry -Wl,--export-all src.cpp -o out.wasm`
- 実測: 1関数で 691 バイト。node 22 の `WebAssembly.instantiate` で export 呼出し成功
- Makefile の `WASM_CLANG` にはこの clang を、`WASM_LDFLAGS` に `-fuse-ld=lld -B/opt/homebrew/opt/lld/bin` を渡す

## 検証方針

C++ CLIレンダラー（プリセット＋イベントJSON → WAV）を基準に native/WASM を許容誤差で比較。block 1/7/64/128/511、
44.1/48/96k で不変性。FFTスイープの折返し比、フィルタIR、ADSR時刻、ピッチcent、DC/NaN/Inf/denormal。
既存ハーネス `random-scale-keys/design/verify/` を流用。「コアのドライ」と「全体ミックス」は別テスト。

## 公開（2026-09-05）

- **https://github.com/aratama-ship-it/synth-engine （public）**。git dir は `~/git-repos/synth-engine`（--separate-git-dir）。
- **ライセンスは未定＝LICENSE ファイルなし**（法的には全権利留保）。README にその旨を明記。決めたら README とあわせて更新する。
- ★**`design/` は非公開**（.gitignore）。判断用HTML・ブレスト生ログ・夜間レポート・試聴ページは手元だけ。
  公開時に **filter-branch で履歴からも design/ を除去**した（作業ツリーのファイルが消えるので、
  `~/git-repos/synth-engine_backup_2026-09-05` から復元した。**同じ操作をするときは必ずバックアップから戻すこと**）。
- ★**署名IDは固定値を持たない**。`shells/apple/build.sh` が `Apple Development` 証明書を自動検出し、
  `SIGN_IDENTITY` で上書きでき、無ければ ad-hoc（`-`）にフォールバックする。履歴からも実IDと Team ID を除去済み。
- ★コミットの Author は `ARATA URAWA <circusarata@gmail.com>`（GitHub アカウントのメール）。ファイル内容には個人情報なし。
- 公開状態の検証: GitHub API で 57ファイル・design/ 0件・wav 0件を確認。**別ディレクトリへ clone して
  `make test`（21/21）・`make wasm`・`shells/apple/build.sh` が通ることを実測**。
- `PROJECT_NOTES.md`（このファイル）と `SPEC_*.md` も公開対象。内輪の書き方が気になるなら後で整理する。

## 進捗ログ

- **2026-09-04 M0a 完了（Codexに実装させ、Claudeが検証済み）**: `make test` 8/8 PASS（block不変ビット一致、1000イベント欠落0、
  発音位置誤差0、NaN/denormal 0、ポリフォニー16、決定論一致、fast_math 誤差 ~5.6e-8、エイリアス比 −96.2 dB）。
  `make core-freestanding-check` PASS。core は `<stddef.h>` `<stdint.h>` 以外に依存無し、`std::` 0件、第三者コード無し。
- **同日 M0c の先行確認**: `make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang` で `build/synth_engine.wasm`（10,448 B、gzip 3,998 B、import 0）。
  `tools/wasm-check/compare.mjs`（node）で同一プリセット＋イベントを native CLI と比較: **最大差 −133.6 dBFS、RMS差 −162 dBFS**
  （M0基準3 = RMS −120 以下・最大 −100 以下を満たす。ビット一致はしない）。state_size = 1,311,711 B（WTミップマップ4slot分）。
- ★落とし穴: `synth_reset(SYNTH_RESET_ALL)` は**パラメータも初期値へ戻す**（README 未決事項）。プリセット設定の後に呼ぶと
  無音相当の別の音になる。ログ再生は「reset(ALL) → set_param → reset(VOICES)」の順にするか、仕様で確定させる（M1で決める）。
- **2026-09-04 M0c（Web殻）Chromium 検証済み**（Codex実装・Claude検証）: `shells/web/` の AudioWorklet で「開始」→ A〜Z 発音（48 kHz、process 平均 0.017 ms）、
  OfflineAudioContext＋Worklet の10秒レンダー成功。native `build/out.wav` との差 **最大 −133.61 dBFS／RMS −162.25 dBFS**（M0基準3 通過）。wasm 10,448 B（gzip 4,010 B）。
  ★不具合を1件修正: AudioWorkletGlobalScope に `performance` が無く Worklet が例外で止まった（Chromium実測）→ `nowMs()` で `Date.now()` に落とす。
  このため画面の p99（1 ms 刻み）と「batch ready」の値は分解能・起点の都合で参考値。プレビューは `.claude/launch.json` の `synth-engine-web`（8963。`/` は demo.html へリダイレクト）。
  **Safari は未確認**（AppleScript 経由の読取が権限で止まるため本人の手で: `open -a Safari http://localhost:8963/shells/web/demo.html`）。
- **2026-09-04 M0b（Apple殻）auval 通過**（Codex実装・Claude検証＋修正3件）: `auval -v aumu Sken Arat` = **AU VALIDATION SUCCEEDED**。
  ★落とし穴3件: ①iCloud配下で codesign 失敗（detritus）→ビルド先は `~/build/synth-engine/apple/` ②App Extension は `-bundle` 不可、
  `-e _NSExtensionMain -fapplication-extension` の実行形式でないと entitlements が付かず pluginkit 未登録 ③`fullState` は `[super fullState]` を土台にする。
  ★Codex はサンドボックスからキーチェーンの署名証明書を見られない→署名を伴うビルドは Claude（通常Bash）か本人が実行する。
  暫定識別子: aumu / `Sken` / `Arat`、Bundle `com.pygmix.synthengine(.au)`。**Logic 12.3 での読込・保存復元は本人確認待ち**。
- **2026-09-05 未明（本人就寝中の自動作業）**: git 初期化（`--separate-git-dir ~/git-repos/synth-engine`）、
  auval 警告の解消、**M1a（オシレーター部）完了**、M0d（AU と CLI の突き合わせ）完了、試聴ページ作成。
  - **M1a**: パラメータ 9〜34 追加（既定はすべて無効側）、engine version 2。slot 0 を sine→triangle→saw→square の4フレームへ。
    `make test` **21/21 PASS**（Claude がクリーンビルドで再実行）。**M0a 出力とビット一致**（後方互換）。
    実測: FM折返し −94.3 dB／ピンク傾斜 −3.57 dB/oct／16音×unison4 で平均 192 µs・p99 224 µs（期限 2667 µs の 8.4%）。wasm 18,962 B。
  - **M0d**: `tools/au-render`（AUv3 を AVAudioEngine のオフラインレンダーで描く）＋ `tools/lib/wav.mjs`。
    ★**AU と CLI はビット一致**（`fixtures/au_compare_vel1.txt`＝ベロシティ1.0）。ベロシティ 0.8 だと差 −57.9 dB になるが、
    これは **MIDI の7bit量子化**（0.8 → 102/127 = 0.80315、信号比 −48 dB）で完全に説明でき、実装の不具合ではない。**M0 基準4 達成**。
  - **auval は警告0**（PresentPreset＝factoryPresets/currentPreset を実装、paramId 0 を AU に公開）。
  - ★**iCloud 配下に置いた実行ファイルからは AUv3 を読み込めない**（`NSOSStatusErrorDomain -1`。同じバイナリを /tmp へ置くと成功）。
    `tools/au-render/build.sh` の出力先は `~/build/synth-engine/`。codesign が iCloud で失敗するのと同じ系統の問題。
  - ★**作業中に残っていた `python3 -m http.server 8963`（ワークスペース全体を全インターフェースへ公開）を停止**し、
    `tools/serve.mjs`（127.0.0.1 のみ・プロジェクト内のみ・Range 対応）へ置き換えた。
  - **試聴ページ** `design/listen/index.html`（9音。M0の素の波形4種＋M1aの5種）。プレビュー 8963 の `/` がここへ来る。
  - ★M1a の未解決の設計上のねじれ: **phaseMode=0 の初期位相が、ユニゾン1声のときだけ 0.25 cycle 固定**（M0a とのビット一致を優先したため）。
    ユニゾン2声以上ならハッシュ開始。M1b で「常にハッシュ」に統一するか決める。
- 残（本人の判断・操作が要るもの）: **Logic 12.3 での読込と保存復元**、**Safari での demo.html**、**試聴ページの音の判定**、
  M1a の位相ねじれの決着、AU の製品名とコード（暫定 Sken/Arat）。

## 進め方

思考・設計・検証は Claude、実装は Codex へ委譲（`_claude-rules/codex-delegation.md`）。
着手前に `_claude-rules/dev-preferences.md` の方針リストを読む。削除・移動は本人承認フロー。
