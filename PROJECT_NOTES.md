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
- **音源構成（M4n現在）**: WT OSC A/B（モーフ、ユニゾン≤4、BがAをFM/PM）＋サブ＋ノイズ、SVF×1、EG×3、LFO×2、
  モジュレーション6スロット、マクロ×4、16音固定・voice stealing・CC64・平滑化。Distortion / Chorus / 3-band EQ /
  Compressorはボイス後の共有コアInsert、Delay / ReverbはWeb専用後段。ドライ出力とFXセンド出力は引き続き別に持つ
- **「同じ音」の境界**: Web と AU で一致させるのは**共有Insertを含むコアPCMまで**。Delay / ReverbはWeb側だけに置く
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

- **2026-09-07 Web Synth Studio shell（ローカル・非公開）**。
  Serum系の役割分割を参照しつつ、SynthEngineの実体に合わせて`OSC / FX / MATRIX`の3作業面へ再構成した。A/B対称OSC、実パラメータから描く波形・ENV・LFO設定図、8 source / 14 destination / 6 slotの名前付きMatrix、Macroから対象への割当てを実装。FXはdry出力を起点に、順序変更可能なDistortion / Chorus / 3-band EQ / Compressorのinsert、その後のdry + Delay + Reverb並列へ変更。Delayは初期BYPASS、Reverbは独立ONで9値を持ち、密なstereo IRと二重Convolver crossfadeにした。全core / space / insert / orderをschemaVersion 1のパッチとして扱い、最大8件保存、自動復元、検索／カテゴリ、Undo / Redo、JSON入出力を追加した。Webテスト30/30、design-lintは3画面×390/1280/1440pxでNG 0/WARN 0。core/C ABI/WASM、AU、スタンドアロン、random-scale-keysは変更していない。聴感とSafari／タッチ実機は本人確認待ち。

- **2026-09-07 プリセット試奏時間とReverb明度の本人フィードバック反映（ローカル・非公開）**。
  10個のWeb SynthプリセットでAMP Sustainを0〜25%、AMP Releaseを約25〜32%短縮し、プリセット固有のReverb Decayも1.0〜3.4秒へ短縮した。比較中に前の音が残り続けないことを優先し、Wide PadとGlass Bellの個性は残す。既存WARMの暗さは保持し、これより暗い素材は増やさず、high-cut 18 kHz・decay 2.2秒のBRIGHTを対照素材として追加した。

- **2026-09-07 Web Synth Reverb DAMPING追加（ローカル・非公開）**。
  HIGH CUTとは別に、残響の高域が尾の中で失われる速さを0〜100%で変えるDAMPINGを追加した。0%は高域と低域を同じ減衰率、100%は従来の高域減衰率とし、WARMを含む既存素材を従来より暗くしない。BRIGHTだけ18%、CLEAR / WARM / GRAINは100%で開始する。既存IR生成の係数・debounce・二重Convolver crossfadeを再利用し、AudioNodeと常時処理は追加していない。Web 32/32、core 60/60、design-lint 390/1440pxはNG 0/WARN 0。48 kHz・Decay 3.8秒のIR生成12回はNode上で中央値13.35 ms、最大30.58 ms（ブラウザ実時間ではなくローカルNode測定）。

- **2026-09-07 M4a 内蔵Wavetable Palette追加（ローカル・非公開）**。
  Reverbは現行の軽い並列FXで一旦固定し、OSC側の4 slotをBasic Shapes / Analog Sweep / Digital Edge / Hollow Formantへ整理した。全slotを4 frame化し、これまでslot 1〜3で実質無効だったPOSに連続した音色変化を与えた。各slotの0%は従来のSine / Saw / Square / Triangle生成式を維持し、旧Sine / Sawゴールデンはビット一致。追加frameは10段mipmapを初期化時に生成し、音声処理ループ・C ABI・76パラメータは不変。OSC A/Bのslot selectorはともに整数へ揃え、engine versionは9。core 61/61、Web 33/33、freestanding、WASM/CLIビット一致、design-lint 390/1440pxでNG 0/WARN 0。WASMは53,751 B（gzip 15,997 B）、native初期化＋1frame renderはウォーム後約0.05秒。ブラウザではHollow FormantのPOS 0→100%で設定図が変わり、C4発音経路まで確認。最終的な各テーブルの質感は本人試聴待ち。仕様は`SPEC_M4a.md`。

- **2026-09-07 M4b Reference Match測定基盤追加（ローカル・非公開）**。
  最終目標を「参照音を測る→編集可能な候補パッチ→音量を揃えたA/B→手動補正」と定義し、最初の垂直スライスとしてStudio画面へ4つ目の`MATCH`タブを追加した。音声はWeb Audioでブラウザ内だけで復号し、外部送信・永続保存・自動パッチ変更は行わない。長さ、peak/RMS、active区間、10–90% attack、単音pitch/confidence、微分ベースbrightness、mid/side width、20ms RMS包絡と入力品質警告を表示する。M2で耳ゲートまで使った包絡・重心・相関を`shells/web/sound-analysis.js`へ共有化し、`tools/compare-timbre.mjs`も同じ定義へ切り替えた。`tools/analyze-sound.mjs`からFloat32 WAVをJSON測定できる。既存4参照音はすべてC4を261.5〜261.9 Hz、confidence 96.9〜99.8%で検出。合成440 Hzとattack/stereo/quiet入力を含むWeb 38/38、core 61/61、freestanding PASS。実Chromiumで`rsk_epiano.wav`を読み込み、261.6 Hz / 100% / attack 20 ms / brightness 315 Hz、page error 0、presetがepianoのまま変わらないことを確認。design-lintは390×844 / 1440×900でNG 0/WARN 0。自動候補生成と候補音のオフラインA/Bは次段階。仕様は`SPEC_M4b.md`。

- **2026-09-07 M4c Reference Match音量補正A/B追加（ローカル・非公開）**。
  参照音のpitch confidenceが70%以上なら、現在の76 core値だけをOfflineAudioContextへ複製し、最寄りMIDI note、先頭無音、active end、現在のAmp Releaseからnote-on/offを決めて最大12秒描画する。候補は`CORE DRY`でInsert / Delay / Reverbを含めず、パッチ本体は変更しない。参照と候補をactive RMS −18 dBFS、peak ceiling −1 dBFSへ別々に補正し、A REFERENCE / B CURRENT / STOPで相互排他的に再生する。包絡相関、pitch cents差、attack差、brightness差をB−Aで表示し、core変更時は旧候補を即無効化する。`rsk_epiano.wav`と復元済みSawで3秒描画し、envelope 0.836 / pitch −0.7 ct / attack −20 ms / brightness +115.5%、A→B→STOP、変更時の無効化、page error 0を実ブラウザで確認。Web 44/44、core 61/61、freestanding PASS、旧M2同一WAV比較OK。design-lintは390×844 / 1440×900でNG 0/WARN 0。Safari、タッチ端末、主観的な音色一致は未確認。仕様は`SPEC_M4c.md`。

- **2026-09-07 M4d Reference Match AMP ENV仮説追加（ローカル・非公開）**。
  20 ms RMS包絡の10–90%立ち上がりとpeak後の安定区間から、AMP Attack / Decay / Sustainの編集候補を作る。Releaseは安定区間後かつ末尾20%内の、音量が戻らないtail dropを検出できた場合だけ提案し、自然減衰や周期変動と分離できなければ`KEEP CURRENT`とする。画面は`CURRENT → SUGGESTED`、値ごとのconfidenceと根拠、READY / PARTIAL / UNAVAILABLE / APPLIEDを表示し、読込時はパッチを変更しない。`APPLY DETECTED`で有限な候補だけを既存Undoへ一手として適用し、古いA/B候補を無効化する。実Chromiumで`rsk_epiano.wav`のREADY→APPLIED→Undo→READY→再適用→RENDER→A/Bを完走し、390pxで横あふれ0、page error 0。4基準音ではEPianoのみReleaseを検出し、Saw / Pluck / Bellは保守的に保持した。Web 48/48、core 61/61、freestanding PASS。design-lintは390×844 / 1440×900でNG 0/WARN 0。推定値の主観的な妥当性、Safari、タッチ端末は未確認。仕様は`SPEC_M4d.md`。

- **2026-09-07 M4e Reference Match Filter Cutoff較正追加（ローカル・非公開）**。
  BrightnessをCutoff値へ直接変換せず、Filter ONかつLP12 / LP24のときだけ、現在のcore dryとCutoffを必要方向へ×2または×0.5した分析専用probeを同じ音程・長さで最大1回描画し、局所的なBrightness応答からCutoff候補を推定する。反応が逆、2.5%未満、範囲端、非LP、BYPASSでは`KEEP CURRENT`へ倒し、提案も現在値の×0.25〜×4へ制限する。`APPLY CUTOFF`はCutoffだけを既存Undoへ一手として適用し、Filter ON / Mode / Resonance / EGを保持して古いA/Bを無効化する。実ChromiumでSaw 1,200 Hzと`rsk_epiano.wav`を比較し、Reference 315 Hz / Current 680 Hz / 600 Hz probe 470 HzからLOW・一手制限付き300 Hz候補を表示、READY→APPLIED→Undo→WAITINGと1,200 Hz復帰を確認した。390pxで横あふれ0、操作高44px、page error 0。Web 52/52、core 61/61、freestanding PASS。design-lintは390×844 / 1440×900でNG 0/WARN 0。候補値の主観的な妥当性、Safari、タッチ端末は未確認。仕様は`SPEC_M4e.md`。

- **2026-09-07 M4f Wavetable mip境界crossfade追加（ローカル・非公開）**。
  自動探索より先にシンセ本体の生成品質を上げる方針へ切り替えた最初の項目。従来は周波数からalias-safeなmipを1段だけ選ぶhard switchだったため、Osc A / Osc B / B→A位相変調源 / Subの全経路で、richer mipが安全になった境界から100 centだけ次の制限mip→primary mipをsmoothstepで補間する。richer mipはNyquist条件を満たす前に読まず、遷移外は従来readerとビット一致する。48 kHz・750 Hz境界のsawで最大サンプル段差を0.412318826から測定限界上0へ低減し、遷移外ビット一致。alias −96.23 dB、FM alias −94.32 dBを維持した。core 62/62、freestanding PASS、8プリセットのnative/WASMは全てビット一致。6 slot・LP24・16音×unison4は平均300.29 µs / p99 379.96 µsでhalf deadline 1333.5 µs以内。C ABIと76パラメータは不変、engine version 10、WASM 54,521 B（gzip 16,321 B）。聴感上の改善は本人確認待ち。仕様は`SPEC_M4f.md`。
- **2026-09-07 M4g 操作スムージング＋unison配置改善（ローカル・非公開）**。
  Osc A/B Morph、Osc A/B Level、B→A FM、Sub Level、Noise Level、Master Gainの手動base値へ5 ms一次スムーサを追加した。発音中だけ追従させ、idleでのpreset読込とcreate/resetは目標値へスナップする。VOICE_PARAMはnote startの即時値、Matrix/LFOは平滑化後baseへの加算として変調の速さを維持する。unisonは声数1〜4と`1/sqrt(U)`正規化を維持し、panの等間隔配置とdetune配置を分離。4声detuneを`-1/-0.2/+0.2/+1`として内側の音程の芯を残す。実測は2/3/4声RMSが1声比+0.04/+0.43/+0.38 dB、4声full widthの左右差0.006 dB・相関0.455、width 0は左右ビット一致。8操作の初回追従率0.004158、50 ms後の最大残差0.0000363。core 64/64、Web 52/52、freestanding PASS、8プリセットnative/WASM全てビット一致。6 slot・LP24・16音×unison4は平均288.44 µs / p99 361.38 µsでhalf deadline 1333.5 µs以内。C ABIと76パラメータは不変、engine version 11、WASM 56,191 B（gzip 16,730 B）。聴感の最終判定は本人確認待ち。仕様は`SPEC_M4g.md`。

- **2026-09-07 M4i Quality Lab通常画面分離（ローカル・非公開）**。
  本人のユニゾン／FM比較完了後、OSC上部の検証パネルを通常URLでは`hidden`にし、日常の音作りをOSCILLATOR A/Bから開始できるようにした。比較機能、4ボタン、状態文、品質パラメータ、DSP、プリセット値は削除・変更せず、`?quality=1`の明示的な検証URLで従来どおり復帰する。Web 53/53 PASS。design-lintは390×844 / 1440×900でNG 0／WARN 0／測定不可0、44px未満0件（通常画面100操作）。実ブラウザで通常URLのLab非表示、OSC A表示、検証URLで4ボタン復帰、通常URLへの復帰を確認した。Safariとタッチ端末は未確認。仕様は`SPEC_M4i.md`。

- **2026-09-07 M4j Web初回出力／鳴り止め安全化（ローカル・非公開）**。
  AudioContext停止中にもWeb FXのAudioParamを`setTargetAtTime`で予約していたため、再開直後だけBYPASS中の4 Insertでdry/wetが各unityから減衰し、理論上最大16倍に重なる経路があった。Delay入力とfeedbackも初期値unityから下がるため、過大な初回音が残響へ流れ込む構造だった。停止中は各値を即時設定し、最終出力を0から25 msで開く安全ゲートを追加。画面鍵盤をpointer ID単位にし、capture喪失、blur、pagehide、visibility hiddenでは待機／発音を消去、voice reset、出力muteを行う。Web 56/56 PASS。実Chromiumで更新後の初期状態、最初の画面鍵盤操作によるAudio開始、700 ms後にactive key 0を確認した。DSPコア、パラメータ、プリセット、AU、スタンドアロンは変更していない。爆発音と鳴り残りが消えたかの最終判定は本人の耳で確認待ち。

- **2026-09-07 M4k Web Reverbゲイン正規化／復元表示修正（ローカル・非公開）**。
  本人確認で爆発音と鳴り続けは解消したが、定常音がDistortionのように聞こえるとの指摘があった。実画面ではDistortion / Chorus / EQ / Compressorは全てBYPASS。10プリセットのcore dry単音は最大でもSawの−4.615 dBFSで、core側の0 dBFS超過は無かった。一方、既定CLEAR IRはpeak 0.78だけで正規化され、二乗和平方根（畳み込みの平均ゲイン指標）が29.641だった。左右IRをそれぞれ二乗和1へ正規化し、CLEAR / BRIGHT / WARM / GRAINを48 kHzで0.9999999997〜1.0000000010に揃えた。素材、長さ、Damping、DC除去、末尾fadeは維持。併せて自動保存Sawを復元しながらセレクタがEPianoと表示する不一致を修正し、実ブラウザでSaw表示／Analog Sweep実値／Distortion BYPASSの一致、初回演奏後active key 0、console error 0を確認した。Web 57/57 PASS。Reverbの聴感上の音量と歪み解消は本人確認待ち。

- **2026-09-07 M4l 独立LFO 2追加（ローカル・非公開）**。
  参照音再現で異なる周期の動きを編集可能に重ねるため、LFO 1と独立したRate / Shape / Retrigger / Phase、global / voice位相、cycle、S&Hハッシュ層を持つLFO 2を追加した。既存6-slot MatrixのSource 8としてだけ接続し、LFO 1の直接送りは維持。既存IDを変更せず79〜82を末尾追加し、83パラメータ・engine version 13とした。C ABIと20 byteイベントは不変。core 67/67、Web 58/58、freestanding PASS、全18プリセットのnative/WASMはサンプル単位でビット一致。6 slot・LP24・16音×unison4は平均279.06 µs / p99 370.50 µsでhalf deadline 1333.5 µs以内。WASM 59,389 B（gzip 17,494 B）。通常OSC面はdesign-lint 390×844 / 1440×900でNG 0／WARN 0、44px未満0件。実ブラウザでLFO 2設定図、Matrixの9 source選択、横あふれ0、console warning/error 0を確認した。音色としての有用性は本人不在のため試聴保留。仕様は`SPEC_M4l.md`。

- **2026-09-07 M4m Macro 3 / 4＋Mod EG追加（ローカル・非公開）**。
  参照音再現で複数特性をまとめて操作し、アンプ／フィルタとは別の時間変化を作るため、5 ms平滑化つきMacroを4本へ拡張し、独立Mod EGのAttack / Decay / Sustain / Release / Curveを追加した。既存MatrixのSource 9〜11として接続し、既存IDとC ABIを維持して83〜89を末尾追加、engine version 14とした。UIはMatrix面へMod ENVを置き、390pxでは1列へ折り畳む。最終統合後のcore 71/71、Web 59/59、design-lint 390×844 / 1440×900はNG 0／WARN 0。本人試聴でMacro 3 / 4とMod Envelopeの動作を確認し、「多分大丈夫」と暫定評価。細かな質感と実用上の変化幅は後日確認するため、機能動作のみ確認済み・音質の最終承認は保留とする。仕様は`SPEC_M4m.md`。

- **2026-09-07 M4n 共有Insert FXコア化（ローカル・非公開）**。
  Web専用だったDistortion / Chorus / 3-band EQ / Compressorを順序変更可能な共有C++コアへ移し、AUからも同じ23パラメータを扱えるようにした。Delay / Reverbは軽いWeb専用後段として維持する。4 Insertは初期BYPASSで既存ゴールデンをビット一致させ、wet／bypassを平滑化、不正順序は既定順へフォールバックする。既存IDとC ABIを維持して90〜112を追加し、113パラメータ・engine version 15とした。core 71/71、Web 59/59、freestanding、CLI、WASMを確認。全18プリセットと4 Insert有効fixtureはnative/WASMでサンプル単位のビット一致。全Insertを加えた最大負荷は平均281.27 µs / p99 369.00 µsでhalf deadline 1333.5 µs以内。WASM 71,784 B（gzip 20,286 B）。Appleソースはarm64 macOS向けcompile-onlyを通したが、署名／登録とLogic実ホストは未確認。本人試聴では「とりあえず良さそう」と暫定承認され、4 Insertはこの状態を基準として一旦固定する。個々の深い質感評価は必要になった時点で再開する。仕様は`SPEC_M4n.md`。

- **当面の進行順（本人不在中）**: 機能計画に沿う実装と自動検証をTerraで進め、聴感・端末・自然さの判断は保留一覧へ分離する。機能面が一巡した時点で本人が上位モデルへ切り替え、既存トークンを前提にUI/UX洗練を独立フェーズとして開始する。

- **2026-09-08 M4o UI/UX整理（09-07夜開始、ローカル・非公開）**。
  既存役割色を保持し、Patch toolsの開閉、見出し横のWave選択、ENV1/2/3・LFO1/2の2バンク、4 Macro横並びを実装。Mod ENVはOSCのENV3へ統合し、MATRIXから編集リンクを置いた。MODボタンは文脈付きのSource/Amountダイアログへ変更し、適用前キャンセル・既存更新/解除・6枠満杯時の上書き防止・単一Undoを検証。FX BYPASS文字の不透明度を維持し、並べ替え後のフォーカスを保持。プリセット検索は現在音色を切り替えず、フィルタ除外時も現在名を表示する。Web59件、独立Playwright13グループ、4タブ×390/1440pxのdesign-lint NG0/WARN0。5画面幅でページ横溢れなし。音源DSP/プリセット/WASM/AUは変更せず、WASM SHA-256 `e21e61e008e9a612e7e68ddcb92d798ebea50ff62e0314caa7cbe930aad544e2` を前後一致確認。ブラウザ試験は本人の編集中パッチとは別コンテキスト。音色の主観評価、実機タッチ、Logic実ホストは引き続き未確認。入口 `design/verify/m4o-ui-20260907/index.html`、再検証 `tools/test-studio-ui.py`。実装前Web3ファイルは同フォルダのbaselineへ保全した。

- **2026-09-08 M4p Web鳴りっぱなし再発対策（ローカル・非公開）**。
  本人から鳴りっぱなし再発の報告を受けた。単純なクリック／PCキー押下では再現しなかったため、再発し得る未保護経路を閉じた。初回Audio準備中に解放またはpanicした要求は世代付きNote Registryで失効させ、失効後に出力ゲートを再度開かない。画面鍵盤のpointerup / pointercancel / mouseupをwindow captureでも回収し、capture失敗時のpointerleaveを追加。PC keyup / keydownもcaptureし、`event.code`に加えて`event.key`をfallbackにする。Escapeは全ノート・voice・出力を即時panicする。同一オリジンの複数シンセタブにはBroadcastChannelで発音権を通知し、新しく弾いたタブ以外を停止する。Note Registryの競合・一括失効・同鍵盤複数入力を3件追加し、Web 62/62、core 71/71、diff check PASS。実Chromiumで修正版読込、初回画面鍵盤、PCキー、Escape後のactive key 0、console warning/error 0を確認。DSPコア、プリセット、WASM、AU、音色パラメータは変更せず、WASM SHA-256はM4o時点と一致。正確な元イベントと聴感上の最終解消は本人確認待ち。

- **2026-09-08 M4q 無音AudioWorklet安全ゲート追加（GitHub公開版）**。
  発音系の変更を一件ずつ止めて検証するため、`shells/web/tests/audio-safety.test.mjs`を追加した。物理出力やAudioContextへ接続せず、実WASMをSynthEngineProcessorへ読み込んで48 kHz／128 framesでブロック処理する。低出力プリセットで初回発音、Morph変更前後の発音継続、note-off、voice resetによるpanicを順に実行し、全サンプルの有限性、peak 0.25以下、release／panic後1e-7以下を必須にした。実測は変更前peak 0.008005、変更後peak 0.008108、全体最大0.009215、release後0、panic前0.005232、panic後0、NaN／Inf 0。Web 63/63、core 71/71、freestanding PASS。GitHub ActionsはWASMビルド後に同じWebテスト入口を実行する。UI、DSPコア、プリセット、WASM、AU、音色パラメータは変更していない。次の機能変更はこのゲート合格後に一件だけ進める。

- **2026-09-08 M4r session-only Custom Wavetable WAV import（ローカル検証済み）**。
  内蔵4 wavetableを維持したままslot 4をCustomへ拡張し、WebのOSC A/Bで共有するローカルWAV読込を追加した。入力はPCM 16/24/32-bitまたはfloat 32-bit、mono/stereo、2048 samples × 1〜4 frames、2 MiB以下へ限定する。stereo平均後にフレーム単位でDC除去・peak 0.95正規化し、コア側でも全入力を先に検証してから10段mipを生成するため、無音／NaN／Inf／過大値の失敗では直前のCustom内容を変更しない。読込前はmainとWorkletの両方でvoice停止、event ring clear、出力ゲート閉鎖を行い、読込後も自動発音・自動selector変更・出力再開をしない。Custom音声はセッション限定でlocalStorage／パッチJSON／外部へ保存しない。未読込のCustom選択は直前値へ戻し、Custom参照パッチを新規セッションで復元するとBasic Shapesへフォールバックして通知する。engine version 16、core 72/72、Web 65/65、freestanding PASS。native/WASMは既存Saw fixtureでサンプル単位ビット一致。WASM 75,383 B（gzip 21,094 B）。無音安全ゲートのCustom slot実測は最大peak 0.008754、release後0、panic後0、NaN／Inf 0。ローカルChromiumで2048-sample stereo float WAVを57.0 msで読込後、出力ミュートのままslot 4選択と設定図更新を確認した。1280px／390pxとも横溢れなし、LOAD WAV 44px、console warning/error 0。Python版Playwrightが環境にないため従来の`tools/test-studio-ui.py`とdesign-lint一括実行は未実施。音色の本人試聴、Safari／実機タッチ、AUからのCustom読込UIは未確認。仕様は`SPEC_M4r.md`。

- **2026-09-08 M4s PC keyboard octave＋Custom WT lifecycle（ローカル検証済み）**。
  PC演奏へ`Z = -1 octave`、`X = +1 octave`を追加し、初期0、範囲-3〜+3、1操作12 semitonesとした。octave変更は全noteをpanic停止して出力gateを閉じてから行い、keydown時の物理key tokenでkeyupを解決するため、変更後noteを誤って解放する残留発音経路を作らない。画面鍵盤も同じoffsetで再描画し、現在のPC音域を文字表示する。Custom WTは読込後にLOADをREPLACEへ変え、CLEAR時は出力を閉じてslot 4を有限な1-frame sineへ置換し、使用中OSCをBasic Shapesへ戻してからセッションデータを破棄する。どちらも自動発音しない。core 72/72、Web 69/69、freestanding、構文、diff check PASS。物理出力へ未接続の実WASMは最大peak 0.008754、release後0、panic後0、clear再読込後0、NaN／Inf 0。隔離ChromiumでLOAD→REPLACE→CLEAR、OSC復帰、5画面幅の横溢れ0、browser error 0を完走。design-lintは390×844 / 1440×900でNG 0／WARN 0／測定不可0、44px未満0件、最悪コントラスト8.10:1。実ブラウザでZ/Xと表示鍵盤の同期、初期状態復帰、console log 0を確認した。音色の本人試聴、Safari／実機タッチは未確認。仕様は`SPEC_M4s.md`。

## 進め方

思考・設計・検証は Claude、実装は Codex へ委譲（`_claude-rules/codex-delegation.md`）。
着手前に `_claude-rules/dev-preferences.md` の方針リストを読む。削除・移動は本人承認フロー。
