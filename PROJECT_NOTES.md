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
- **2026-09-05 ★selftest.html の音出しボタンにバグ→本人指摘で発覚→修正→Safari実機で発音確認OK**。
  `noteOn(note, velocity, atFrame)` の引数順を誤り `noteOn(id, note, atFrame)` で呼んでいたため、
  実際にはMIDIノート番号「200」台という範囲外の値で発音していた（自動検査は「指示を送った」ことしか
  見ておらず、実際に鳴ったかは自己申告任せだった）。本人「なってない気がしますが」で発覚。
  引数順を修正しコミット・push。**本人がSafariで再確認し「なります」で発音OK。**
  ★教訓: 「操作を実行した」ことの確認と「意図した結果が起きた」ことの確認は別。特に音・見た目など
  機械的に検証しづらいものは、実装側のログではなく本人の知覚に頼る箇所を明確に分けておく。
- **2026-09-05 M2 完了（4音色の再現）**。旧音源との数値比較で**4音色すべて目標達成**。本人の耳ゲート待ち。

| 音色 | 振幅包絡の相関（目標0.95+） | スペクトル重心の平均差（目標15%以内） |
|---|---|---|
| epiano | 0.955 | 5.5% |
| saw | 0.972 | 3.5% |
| pluck | 0.963 | 4.9% |
| bell | 0.975 | 2.9% |

  - **写像**: FM深さのエンベロープ＝フィルタEGをマトリクス経由で流用（epiano/bellは元々フィルタEGを使っていないので競合なし）。
    1オクターブ上のサイン層＝サブオシレーター（`subOctave` の範囲を -2..0 → -2..+1 に拡張、テスト49追加）。
  - ★**当てはめで判明した3つの落とし穴**（いずれも数値が合わない原因を追って特定）:
    1. **Web Audio の BiquadFilter の Q は lowpass/highpass では「デシベル指定」**。Q=4 は線形換算で 1.585。
       素直に Q=4 として換算すると重心が 33.7% も明るくなった。dB換算した `resonance=0.688` で 8.0% に収束。
    2. **`oscADetune` は「±その値」**（総開き幅は2倍）。参照の「±6セント」に detune=12 を入れて
       うなりの周期が半分になっていた。detune=6 が正解。**うなりの周期から気づけた。**
    3. **ユニゾンの初期位相が乱数だと、うなりの位相が参照と揃わない**。参照（Web Audio）は位相0固定。
       `oscAPhaseMode=1, oscAPhase=0` で揃えたら pluck の包絡相関が 0.647 → 0.910 に改善。
  - ★**構造的に合わせきれない差（記録）**: 旧音源は FM の変調量を **Hz固定**で指定しているため
    **高い音ほど FM が浅くなる**。synth-engine は位相変調の深さが一定なので高音域では硬くなりうる。
    比較は C4 単音のみ。埋めるならノート位置→FM深さへ負のマトリクス結線で可能（先回りでは足していない）。
  - ★pluck のノイズは旧音源では独立レイヤー＋専用LPだが、synth-engine ではボイスのフィルタを共有する。許容。
  - 参照音の取得: `tools/ref-render.html`（`/ref/` 読み取り専用マウント経由で旧 synth.js を import し、
    `stem:"lead"` でドライのリード音だけを OfflineAudioContext でレンダー →`POST /refwav`→ `build/ref/`）。
    比較は `tools/compare-timbre.mjs`。
- **2026-09-06 ★M2 の耳ゲート通過**。本人の A/B 判定は **「そんなに変化を感じない。どちらでもいい」**。
  ★これは M2 の目標（音源を差し替えても劣化しない）が達成されたということ。**4音色とも置き換え可。**
  ★ただし「音が良くなった」わけではないので、**M3 の動機は音質ではなく「エンジンを1本化して AU/スタンドアロンでも
  同じ音を使えるようにすること」**である、と位置づけを明確にしておく。
- **2026-09-06 M3a 完了（音符ごとのパラメータ上書き＋センド出力）＋ 検証基盤の2つの修正**。
  - **M3a**: `SYNTH_EV_VOICE_PARAM`（許可リスト22項目・次のノートオンにだけ効く・持ち越さない）と
    `sendLevel`(75)／`synth_process_send`。engine version 7、パラメータ76。**57/57 PASS**。
    実測: 上書きで重心3.30倍・3音目は差0%、センドはドライの半分で誤差0、p99 300µs。
    → **これで sweep（その音だけフィルタが開く）と delay（その音だけ送る）が1インスタンスで作れる。**
  - ★★**`-ffp-contract=off` を既定にした（重要）**。積和融合命令（FMA）が有効だと丸めが変わり、
    **FM を使う音色でネイティブと wasm が最大 −83.7 dBFS ずれていた**（基準 −100 を超過）。
    無効にすると **8プリセット全てでビット一致**。処理時間 236→294 µs（p99 364 µs、期限の14%）で余裕十分。
    ★**AU 側（`shells/apple/build.sh` の4箇所）にも同じ指定が要る。**片方だけだと AU と CLI がずれる。
    → **3つの殻の一致が「−100 dBFS 以内」から「ビット一致」に強化された。**
  - ★★**ゴールデンが `/tmp/` にあり、再起動や新規 clone で5テストが落ちる状態だった**（テスト22・35・39・42・50）。
    Claude が委譲のたびに作った一時ファイルを参照していたのが原因。**FNV-1a 64bit のハッシュ定数**に置き換え、
    `tests/` から `/tmp` 参照を全廃。**新規 clone で 57/57 PASS を実測確認**。
    ★教訓: **テストが参照する基準データを、リポジトリの外（一時領域）に置かない。**
    README に「clone して make test」と書いた以上、その経路を実際に試すまで完了ではない。
  - 参照音の保存先も `build/`（クリーンビルドで消える）から `design/verify/ref/` へ移した。
- **2026-09-06 本人の実機判定（M3b）**: 「**sweep は動いてなさそう、delay は動いてそう**」。
  ★調べた結果、**実装の問題ではなく音色の性質**だった。旧音源と新音源で sweep の効き具合を実測比較:

  | 音色 | 旧音源 | 新音源 |
  |---|---|---|
  | epiano | 0.94倍 | 1.01倍 |
  | bell | 1.03倍 | 1.07倍 |
  | **saw** | **4.04倍** | **3.9倍** |
  | pluck | 1.13倍 | 1.09倍 |

  （明るさ＝スペクトル重心が 0.06s → 0.40s で何倍になるか）
  ★**epiano と bell は FM の正弦波ベースで倍音がほとんど無いため、フィルタを開いても削るものがない。**
  世界 daylight の既定音色は epiano／bell なので、sweep キーを押しても変化が分からない。**旧音源でも同じ。**
  → **新音源は旧音源の挙動を正しく再現している（差は 0.07倍以内）。** sweep を聴くなら世界 night（saw／pluck）。
  ★教訓: 「効果が効いていない」という報告は、**まず旧実装で同じ条件を測って比較する**。
  実装を疑う前に、元からそうなのかを確かめる。
  - delay（センド出力）は本人判定で動作確認済み。
- 残（本人の判断・操作が要るもの）: **試聴ページの音の判定**、
  M1a の位相ねじれの決着（M2で）、AU の製品名とコード（暫定 Sken/Arat）。次の実装は **M1b-2**（`SPEC_M1b2.md`＝パラメータ定義をコアに一本化して AU/Web へ公開）。

- **2026-09-06 M3c-1 完了（Web Worklet の時計原点を AudioContext と統一）**。
  Worklet 内部の生成時ゼロ起点ではなく `AudioWorkletGlobalScope.currentFrame` をライブ時刻の正本にし、
  `context.currentTime * sampleRate` で予約する呼び出し側と一致させた。Node上の単体検査には従来カウンタをfallbackとして残す。
  既に500 ms動作中のContextへノードを後から挿した実Chromiumプローブで、修正前の490.7 ms遅延に対し、
  修正後は `actualContextFrame = workletFrame = targetFrame = 24704`、遅延0 msを確認。
  同じworkletを random-scale-keys へバイト一致で反映。C++コア/C ABI/WASM/旧音源経路は変更なし。仕様は `SPEC_M3c1.md`。

- **2026-09-06 M3c-2 完了（同時発音のVOICE_PARAMを入力順バンドルへ修正）**。
  同一offsetで`VOICE_PARAM`を全て先に集める処理と、Workletのkind優先ソートを廃止した。
  `NOTE_OFF`と`PARAM/MACRO`を先に処理した後は、`VOICE_PARAM* → NOTE_ON`を入力配列順に一つずつ処理する。
  これにより通常C4とdelay付きG4を同時予約しても、delay設定はG4だけへ適用される。
  `SynthEvent`の20 byte ABIとイベントkindは維持し、同時発音の意味変更に伴いengine versionを7から8へ更新。
  コア59/59、Web13/13、freestanding、WASM/CLI dry/sendビット一致を確認。仕様は`SPEC_M3c2.md`。

- **2026-09-06 M3c-3 完了（同音連打を発音ハンドルで個別終了）**。
  Webの`noteOn()`／`noteOnWith()`は発音ごとに不透明な`NoteHandle`を返し、`noteOff(handle)`だけを受け付ける。
  MIDI音高・別Nodeのhandleは明示的に拒否し、内部の発音IDは1..0xffffffffで単調増加・再利用なしとした。
  同じC4を重ね、片方のOFF後にもう片方が残るPCMをblock 1/7/64/128/511で固定した。
  C ABIの20 byte `SynthEvent`、DSP、engine version 8、WASMは変更なし。
  コア60/60、Web13/13、freestanding、WASM/CLI dry/sendビット一致を確認。仕様は`SPEC_M3c3.md`。

- **2026-09-06 Web Synth UI 追加（ローカル・非公開）**。
  `shells/web/synth.html`を追加し、既存4プリセットと物理/画面鍵盤、OSC A、OSC B/MIX、FILTER、AMP EG、LFO/Macro、詳細パラメータの編集面を作成した。
  Web Node APIの`setParam()`と既存プリセットを使うだけで、DSP/C ABI/WASM、AU、スタンドアロン、random-scale-keysは変更なし。
  390×844と1440×900のdesign-lintはNG 0/WARN 0。設計メモとトークンは`design/SYNTH_UI_*.md`。
  同日の操作性修正で「AUDIOを開始」ボタンを廃止。AudioContext/Workletは先読みし、最初の画面鍵盤またはPCキー操作でresumeと発音を一続きにした。初期化待ちにキーを離した場合は発音を開始せず、フォーカス離脱時も待機中／発音中の両方を解除する。
  続く修正でrange操作後にもPC鍵盤入力を受けるようにした。以前はrangeがフォーカスを保持すると`keydown`を入力欄として除外し、音源停止に見える状態になっていた。プリセット選択中だけは通常の選択操作を優先する。
  音色拡張の第1波として、既存DSPだけで作る6つの試聴候補（Wide Pad / Warm Bass / Glass Bell / Bright Pluck / Motion Lead / Air Keys）を追加。プリセット読込は全パラメータを既定値へ戻してから適用する方式に改め、前の音色設定が次の音色へ混ざらないようにした。プリセット選択後はselectからフォーカスを外し、すぐPC鍵盤演奏へ戻れる。空間系エフェクトは別waveで、既存のsend出力を使って追加する計画。

- **2026-09-06 Web Synth SPACEバス追加（ローカル・非公開）**。
  Web殻だけで既存のsend出力（出力1）を120 Hzハイパス後にフィードバック・ディレイと畳み込み残響へ分岐させた。dry出力（出力0）は従来どおり直接出力するため、DSP/C ABI/WASM、AU、スタンドアロン、random-scale-keysは変更なし。UIは`SEND / ECHO / TIME / SPACE`の4操作とし、Studio 6音色には用途別のセンド量と初期空間値を付与した。`shells/web/space-effects.js`は依存なしで、テストはセンド出力だけを経路に使うことと値の範囲を検査する。聴感の最終判定は本人確認待ち。

- **2026-09-07 Web Synth 残響の質感追加（ローカル・非公開）**。
  SPACEへ`MATERIAL`（CLEAR / WARM / GRAIN）を追加。各選択は畳み込みインパルスの長さ・減衰・密度、残響バスのローパス周波数、プリディレイを同時に変える。CLEARは既存の明るい密な残響に近く、WARMは高域を抑えた長い残響、GRAINは短く疎らな反射である。Studio 6音色に素材ごとの初期値を設定し、MATERIAL選択後はPC鍵盤の入力に戻れるようselectをblurする。コアDSP/C ABI/WASMには変更なし。聴感は本人確認待ち。

## 進め方

思考・設計・検証は Claude、実装は Codex へ委譲（`_claude-rules/codex-delegation.md`）。
着手前に `_claude-rules/dev-preferences.md` の方針リストを読む。削除・移動は本人承認フロー。
