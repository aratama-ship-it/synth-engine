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
- **2026-09-05 M1b 完了（フィルタ・フィルタEG・LFO）**（Codex実装・Claudeがクリーンビルド＋独立計測で検証）:
  パラメータ 35〜52、engine version 3。`make test` **34/34 PASS**、M0a・M1a のゴールデンとビット一致。
  実測: カットオフ誤差 最大0.34%／LP12 −11.94・LP24 −23.88 dB/oct／共振ピーク +13.82 dB／キートラック 2.003倍／
  LFO 周期誤差 0%／16音×unison4＋LP24＋LFO で平均 168 µs・p99 202 µs（期限 2667 µs の 7.6%）／wasm 28,452 B。
  - ★Claude の独立計測: LP24 で明るさ 1388→432 Hz、スイープ 810→300 Hz、ワブル 毎秒5.0回（設定5Hz）、
    トレモロ 毎秒6.2回（設定6Hz）、キートラック 2オクターブで 4.03倍。**フィルタとLFOは実際に効いている**。
  - ★**共振は「自己発振」しない**。resonance=1 は Q=100 相当で、カットオフ周波数にリンギングし 136 dB/秒 で減衰
    （理論値と一致）。仕様書の「自己発振する」という記述は実測に合わせて訂正済み。さらにフィルタはアンプEGの前段なので、
    ボイスが閉じるとリンギングも消える（減算方式の通常の挙動）。
  - ★テスト26（高共振の安定）は「入力ゼロなら出力ゼロ」で自明に通る弱いテスト。共振が鳴ることの担保はテスト25。
- ★**Codex の既定モデルが `gpt-6-astra` になっており、この CLI 版（0.144.3）では 400 エラーで即死する**（2026-09-05）。
  しかも**終了コードは 0** なので気づけない。委譲時は **`-m gpt-5.6-sol` を明示**し、ログに `invalid_request_error` が
  無いことを必ず確認する。
- **2026-09-05 本人の試聴判定（M0＋M1a＋M1b の15音）**: 「全体的にとてもいい感じです」。
  - ①フィルタ無し→LP24 の差 = OK ／ ③ユニゾン有無 = OK
  - ★②フィルタスイープに指摘: **「スイープというより、アタックで一気にフィルターがかかる感じ」**。
    Claude が実測して裏取り: `filterEgDecay=0.9秒` なのに**明るさ変化の50%が0.03秒・80%が0.12秒で完了**していた
    （減衰時間の3%と13%）。原因は1極の指数ディケイ（`coef = 2^(-8/samples)`）で動きが頭に偏るため。
    → **M1b-3（エンベロープのカーブ、パラメータ53・54）**を追加して対応。既定0は現行と完全一致。
  - ★教訓: **エンベロープは「時間」だけでなく「カーブ」を持たないと、指定した秒数と体感が合わない。**
- **2026-09-05 ★Logic Pro 12.3 での確認 = 本人OK（M0b ゲート通過）**。AU が読み込め、鳴り、プリセットが切り替わり、
  保存→再起動で復元される。**これで「ひとつのコアを AU / スタンドアロン / Web の3つの殻で鳴らす」構想は実証済み**。
- **2026-09-05 M1b-2 完了**（パラメータ定義をコアに一本化）: `synth_param_count` / `synth_param_info` を C ABI に追加し、
  AU の parameterTree をコアから動的構築（従来は0〜8の9個だけ手書きだった）。**AU に55パラメータ全部が出る**。
  ファクトリープリセットは `presets/*.txt` から `gen_presets.sh` で生成（Init / Saw Lead / Filter Sweep / Wobble）。
  - ★**私（Claude）の確認漏れ**: この実装は Codex が既に済ませていたのに、特定パスだけをコミットしていたため
    未コミットのまま working tree に残っていた。**委譲のあとは必ず `git status` を確認する**。
  - ★`gen_presets.sh` がパラメータ上限を 52 で決め打ちしており、M1b-3 の 53/54 を弾いてビルドが落ちた。
    コアの `params.hpp` の `kParamCount` から読むよう修正済み。
- **2026-09-05 M1b-4 完了（乱数ハッシュを経路非依存に）**。★**これで3つの殻の一致が全機能で実証された**:
  - **AU と CLI が3プリセット（m0_saw / m1_unison_saw / m1b_filter_sweep）すべてでビット一致**
  - wasm と native の差は 最大 −133〜135 dBFS・RMS −160〜164 dBFS（float32 の丸め程度）
  - 変更内容: 位相とノイズのハッシュ入力を `event.id`／`noteId` から **`Voice::startOrder`**（発音の通し番号）へ。
    MIDI 1.0 にノートIDが無いため AU 側が代用IDを使っていたのが原因だった。
  - 音の性格は保存（RMS 差 0.05 dB、スペクトル重心差 3.0%）。M0a のビット一致も維持。engine version 5。
  - ★**設計原則として確立**: 乱数の入力に経路依存の値（イベントID等）を使わない。
  - ★私の検証ツールにも同じ種類の誤りがあった: `tools/wasm-check/compare.mjs` が CLI と違う seed（1）で
    reset していたため、wasm 側だけ差が出ていた。**比較ツールは比較対象と同じ手順を踏ませる。**
- **2026-09-05 ★Safari 実機で自動検査 10/10 合格**（M0c の残課題が解消）。
  `shells/web/selftest.html` を作り、**開くだけで自動判定してローカルへ結果を送る**方式にした
  （Safari は Claude のブラウザツールから操作できないため。受け口は `tools/serve.mjs` の `POST /report`、
  記録は `build/browser-reports.jsonl`。127.0.0.1 のみ）。
  - ★**設計初期から「要確認」だった OfflineAudioContext + AudioWorklet の組み合わせが Safari で動く**ことを確認。
  - ネイティブとの差は Chromium と完全に同じ（最大 −133.6 dBFS ／ RMS −162.2 dBFS）。
  - ★Safari の方が速い: Worklet 起動 68 ms（Chromium 591 ms）、オフラインレンダー 86 ms（同 675 ms）。
- **2026-09-05 本人の試聴判定（M1c マクロ）= OK**。「ちょっとバリバリっぽさがあるが、とりあえずOK」。
  ★Claude が切り分け: マクロの刻み（0.1秒ごと48段階）が原因ではなく（5msごと960段階でも同じ）、
  **ノコギリ波・矩形波そのものの質感**だった（正弦波・三角波では隣接サンプル差の外れ値ゼロ、
  鋸で2231個・矩形で4326個）。不具合ではない。デモのマクロを矩形波の手前で止めれば和らぐ。
  - ★測定の教訓: **零交差率は波形の形が変わると明るさの指標にならない**（矩形波は基音と同じ2回/周期）。
    微分ベースのスペクトル重心 `sr/(2π)·√(Σ(x[n]-x[n-1])²/Σx[n]²)` を使う。
- 残（本人の判断・操作が要るもの）: **試聴ページの音の判定**、
  M1a の位相ねじれの決着（M2で）、AU の製品名とコード（暫定 Sken/Arat）。次の実装は **M1b-2**（`SPEC_M1b2.md`＝パラメータ定義をコアに一本化して AU/Web へ公開）。

## 進め方

思考・設計・検証は Claude、実装は Codex へ委譲（`_claude-rules/codex-delegation.md`）。
着手前に `_claude-rules/dev-preferences.md` の方針リストを読む。削除・移動は本人承認フロー。
