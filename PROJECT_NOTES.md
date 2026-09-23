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

- **2026-09-08 M4t Custom WT frame position（ローカル検証済み・未公開）**。
  Custom WT読込済みかつOSC A/Bのいずれかが`Custom · Session`のときだけ、既存のCustom WT帯へ`FRAME POSITION`を表示する。A/Bの`POS`を各1〜4 frameの連続位置へ変換し、`F2 → F3 · 50%`の文字、active tick、markerを同じ位置として同期する。Customを使わない側は`OTHER WT`と明記し、Custom未選択時とCLEAR成功後は帯を隠す。表示専用のため、AudioNode、DSP、patch JSON、localStorage、出力gateを変更しない。Web 70/70、core 72/72、freestanding、構文、diff check PASS。隔離Chromiumで4-frame WAVを読み込み、A=F2→F3 50%／B=F4、CLEAR後の非表示、390px表示中の横溢れ0、既存4タブ×5画面幅の横溢れ0、browser error 0を確認。design-lintは4タブ×390×844 / 1440×900でNG 0／WARN 0／測定不可0、44px未満0件、最悪コントラスト8.10:1。仕様は`SPEC_M4t.md`。

- **2026-09-08 M4u HQ FM Guardの高域深さ回復（ローカル検証済み・未公開）**。
  本人試聴で「HQはかなり丸い」、Legacyは良好との判断を受け、既存のHQ Guardだけを調整した。45% sample-rateを越える最初のsidebandで深さを0にする安全境界は維持しつつ、その下のstrict深さ見積りを最大1.5倍へ回復し、要求FM値を超えないようにした。Legacy、既定値、既存parameter ID 78、パッチ、UI、ルーティング、C ABIは変更していない。48 kHz／C8／FM 100%ではHQ深さが0.251468から0.377203へ戻り、off-grid folded energyはLegacyの9.110 dBに対して−13.364 dB（22.474 dB低い）。C5ではHQ/Legacyがビット一致し、MIDI 0〜127のHQ深さは有限・0〜1・単調非増加を確認。opt-in PCM変更としてengine versionを17へ更新した。core 72/72、freestanding PASS、専用C8 HQ fixtureのnative/WASMはビット一致（最大差−∞ dBFS、NaN 0）。物理出力へ未接続のWorklet安全テストはHQ→Legacy切替で最大peak 0.006636、release後0、panic後0、NaN／Inf 0。Python Playwright環境が見つからず既存`tools/test-studio-ui.py`一括回帰は未実施だが、UIソースには変更なし。主観上の採否は、本人帰宅後に低音量で`?quality=1`のLegacy/HQ比較を行うまで保留。仕様は`SPEC_M4u.md`。

- **2026-09-08 M4v 高域OSC／HQ FMの3 sample-rate測定（ローカル検証済み・未公開）**。
  M4uの音源処理は変えず、C8（MIDI 108）で内蔵4 wavetableのPOS 50%と、B→A FM 100%のLegacy／HQを44.1／48／96 kHzへ拡張して固定測定するcore回帰を追加した。4 wavetable中の最悪off-grid比は順に−91.634／−91.663／−91.600 dBで、全て−60 dB基準を通過。FMのHQ深さは0.327158／0.377203／0.993138、Legacy→HQのoff-grid比は9.110→−16.554 dB（25.664 dB減）／9.110→−13.364 dB（22.474 dB減）／−6.591→−6.963 dB（0.372 dB減）。96 kHzではC8の余裕が増えHQ制限がほぼ解除されるため、同帯域での小さい差を品質低下とは扱わない。C5では全3 rateでLegacy/HQがビット一致。既存C8 HQ fixtureもnative CLIとWASMが全3 rateでビット一致、WASM NaN 0。core 73/73、freestanding、Web 70/70、物理出力未接続の安全ゲート（最大peak 0.006636、release/panic後0、NaN/Inf 0）を通過した。数値は聴感の優劣ではなく固定条件の安全／差分指標であり、本人の低音量試聴は保留。仕様は`SPEC_M4v.md`、判断用入口は`design/verify/m4v-high-range-sample-rate-20260908/index.html`。

- **2026-09-08 M4w AudioWorklet再生成／sample-rate安全回帰（ローカル検証済み・未公開）**。
  音源処理・WASM・UIを変えず、物理出力未接続の実WASM／`SynthEngineProcessor`検査を追加した。44.1／48／96 kHzごとにprocessorを新規生成し、初期8 blockの無音、C8・HQ FM保持音の有限性とpeak 0.25以下、次のrateへ移る前の旧processorへの`reset(VOICES)`後8 block無音を検査する。実測の初期peak／旧processor尾部／最終尾部は全て0、C8保持時peakは0.010312／0.010122／0.010352、NaN／Inf 0だった。テスト内のsample rate切替はprocessor生成時だけに限定し、既存の安全テストとも直列化した。これは明示resetを伴うWorklet再生成のシミュレーションであり、実ブラウザでのオーディオデバイス切替、module cache、実スピーカー出力は未検証。core 73/73、Web 71/71、WASM buildを通過した。仕様は`SPEC_M4w.md`。

- **2026-09-08 M4x 実ブラウザOfflineAudioContext再生成安全確認（ローカル・非公開）**。
  Node上のM4wに加え、HTTP配信された実ブラウザで`OfflineAudioContext`と実`AudioWorkletNode`を44.1／48／96 kHzごとに連続生成する検査ページを追加した。各rateで最初のContextはC8・HQ FMを保持したまま終了し、次に生成するContextは初期無音から同じ音を発音してnote-offする。実測で最初／再生成後の初期peakは全rate 0、旧Context末尾peakは0.008108前後、再生成後の発音peakは0.008211／0.008276／0.008977、再生成後のrelease tailは全て0、NaN／Inf 0だった。出力は`OfflineAudioContext.destination`だけへ接続し、物理スピーカー・通常AudioContext・UI操作を使っていない。これはブラウザ内のWorklet再生成を確認するが、ライブ`AudioContext.close()`、デバイス抜き差し、実デバイスsample rate変更、聴感は未検証。既存のcore 73/73、Web 71/71、freestandingを再実行して通過。仕様は`SPEC_M4x.md`、実行入口は`shells/web/tests/context-recreate-safety.html`。

- **2026-09-08 M4y／M4z Browser Context再生成のCI固定（GitHub Actions／Pages確認済み）**。
  GitHub Pages workflowのbuild jobへ、WASM／core／Node Webテストの後に`make browser-context-recreate-check`を追加した。127.0.0.1の一時HTTPサーバー、空のChrome profile、`--headless=new`／`--mute-audio`、OfflineAudioContextを使い、物理スピーカーを使わない。初回のChrome CLI `--dump-dom`は非同期render完了前にDOMを取得したため、Python標準ライブラリだけのChromeDriver sessionへ変更し、`data-status="pass"`を最大60秒pollする。Chromeのbare command解決とdriver起動の最大30秒待機も固定した。run `34205807512`（commit `17fd7ea`）でcore 73/73、Web 71/71、Browser Context再生成、artifact、Pages deployまで成功し、公開`synth.html`はHTTP 200かつローカルとSHA-256一致を確認した。npm／pip installや公開音源の追加はない。ライブ`AudioContext.close()`、デバイス変更、実スピーカー、聴感は未検証。仕様は`SPEC_M4y.md`／`SPEC_M4z.md`。

- **2026-09-08 M4aa FILTER BYPASSクロスフェード（ローカル検証済み・未公開）**。
  FILTERを発音中にON／BYPASSしたときだけ、ボイスごとのdry/wetを既存の5 ms係数で往復させるようにした。FILTER ONで開始するノートは初回サンプルから従来どおり100% wet、BYPASS開始は100% dryであり、既存プリセット、パラメータID／数、C ABI、UI、静的なフィルタ音色は変更していない。BYPASSへ戻り切るまでSVFを処理し、mixが0になってから内部状態を消去するため、後の再有効化で古いstateを引き継がない。coreの専用回帰ではON直後mix 0.004158、50 ms後0.999954、OFF直後0.995797、50 ms後0.000045、後続state消去、有限出力を確認し、engine versionを18へ更新した。core 74/74、freestanding、WASM、Web 71/71を通過。物理出力未接続の実WASM AudioWorklet安全ゲートにもframe 2048 ON／3072 BYPASSを追加し、最大peak 0.006636（上限0.25）、NaN／Inf 0、release後0、panic後0を確認した。実スピーカー、聴感、ライブデバイス切替は未検証。仕様は`SPEC_M4aa.md`。

- **2026-09-08 M4ab 保持中EG操作の5 ms追従（ローカル検証済み・未公開）**。
  発音中にAMP Sustain、FILTER Sustain、FILTER ENV AMOUNTを変えると、既存ボイスの音量またはカットオフが即時に跳んでいたため、各ボイスに現在値を持たせて既存の5 ms係数で追従させた。新しいノートは、他のボイスが旧値へ追従中でも変更後の現在値から開始する。Attack／Decay／Release／Curve、既定のエンベロープ形状、パラメータID／数、C ABI、UI、パッチ、静的なプリセット音色は変更していない。coreの専用回帰では3値とも初回追従率0.004158、50 ms後の最大正規化残差0.000046、保持中の旧ボイスと新ノートの値分離、有限出力を確認し、engine versionを19へ更新した。最終のcore 75/75ではM1b p99 0.294 ms、4 Insert p99 0.378 ms（基準1.333 ms）。ただし共有マシン上の別試行では単発のp99外れ値があり、長時間の実時間負荷は未確認。物理出力未接続の実WASM AudioWorklet安全ゲートにはframe 1536 AMP Sustain／2304 FILTER ENV AMOUNT／2816 FILTER Sustainを追加し、最大peak 0.006636（上限0.25）、NaN／Inf 0、release／panic後0を確認した。freestanding、WASM、Web 71/71、フィルタ有効の96,000 frame native/WASM完全一致も通過。実スピーカー、聴感、ライブデバイス切替は未検証。仕様は`SPEC_M4ab.md`。

- **2026-09-08 M4ac FILTER MODEクロスフェードと表示対応修正（ローカル検証済み・未公開）**。
  保持音でFILTER MODEを切り替えると、LP/BP/HP/Notchや12/24 dB経路が一サンプルで入れ替わっていた。旧経路と新経路をボイスごとの独立SVF stateで並走させ、既存の5 ms係数で出力を交差させるようにした。切替途中の再操作は現在の遷移をリセットせず、最後に選んだmodeを予約して次の滑らかな遷移へ回す。通常経路とMatrix経路は同じ実装を通る。新ノートと完全BYPASSからの再有効化は現在modeで直接開始するため、既定の静的音色を変えない。調査でWeb上のMODE名がDSP IDと不一致だったため、表示を `LP12 / BP12 / HP12 / NOTCH / LP24 / HP24` に修正し、MATCHのCutoff較正も実際のLP12（ID 0）／LP24（ID 4）だけを受け付けるよう同期した。ID、パラメータ数、C ABI、係数、プリセット／パッチ形式は不変、engine versionは20。core 76/76、Web 71/71、freestanding、CLI、WASMを通過。`m1b_filter_sweep` 96,000 framesはnative/WASM完全一致（NaN 0）。物理出力未接続の実WASM AudioWorklet安全ゲートはmode frame 2176/2432/2688、ON/BYPASS frame 2048/3072で最大peak 0.006636（上限0.25）、NaN/Inf 0、release/panic後0。実スピーカー、聴感、ライブデバイス切替、長時間実時間負荷は未検証。仕様は`SPEC_M4ac.md`。

- **2026-09-08 M4ad FILTER密操作の無出力安全ゲート拡張（ローカル検証済み・未公開）**。
  音源DSP／UIを変更せず、実WASMの`SynthEngineProcessor`へ出力未接続で3音×4 unisonの保持音を与え、FILTER ON/BYPASS、6 MODE、Cutoff／Resonanceの両端、Key Track、Filter ENV Amount、Filter EG、per-note override、LFO 1→CutoffとLFO 2→ResonanceのMatrix経路、mode連続操作を1列へ組み合わせた。note-off後と、新しいnote後のvoice-reset panic後は無音を必須にした。初回のfixture master 0.08はpeak 0.749で上限0.25を越えたため、上限を緩めず、試験専用の低出力masterを0.02へ較正した（製品DSP・既定音色は未変更）。最終値はautomation／maximum peak 0.187264、release 0、panic前 0.001599、panic後0、NaN／Inf 0。Web 72/72 PASS。これは低出力・物理出力未接続の自動回帰であり、実スピーカー、全パッチ、ライブデバイス切替、聴感の安全性を証明するものではない。仕様は`SPEC_M4ad.md`。

- **2026-09-08 M4ae FILTER密操作の3 sample-rate無出力回帰（ローカル検証済み・未公開）**。
  M4adの製品DSP／UI未変更の密操作列を、実WASMの新規`SynthEngineProcessor`で44.1／48／96 kHzへ拡張した。各rateで3音×4 unison、FILTER ON/BYPASS、6 MODE、Cutoff／Resonance、Key Track、Filter ENV／EG、per-note override、LFO 1→Cutoff／LFO 2→Resonance Matrixを同じframe列で動かし、peak上限0.25、有限値、release／panic後無音を独立に判定する。automation／maximum peakは順に44.1 kHz `0.083455`、48 kHz `0.187264`、96 kHz `0.104587`。3 rateともrelease／panic後0、NaN／Inf 0で通過した。Web 72/72、WASM build PASS。物理出力、ライブのデバイス切替、任意の高出力パッチ、聴感の安全性は未検証。仕様は`SPEC_M4ae.md`。

- **2026-09-08 M4af FILTER同一frame／block境界の無出力回帰（ローカル検証済み・未公開）**。
  48 kHz・128 framesの実WASM `SynthEngineProcessor`で、block直前・境界・直後の127／128／129、255／256／257、511／512／513 frameに同一frameのFILTER操作束を置いた。各束はON/BYPASS、MODE、Cutoff、Resonanceを順序どおりに送り、129／257ではper-note overrideをnote-onより先に同frameで送り、511ではLFO 1→Cutoff Matrixを追加した。3音×4 unisonを保持してから同時note-off、新note、voice-reset panicまでを出力未接続で検査し、boundary peak `0.008406`、release 0、panic前 `0.001576`、panic後0、NaN／Inf 0で通過。Web 73/73、WASM build PASS。これは固定のevent order／block位置の回帰であり、ライブスケジューリング、実スピーカー、任意の順序・高出力パッチ、聴感は未検証。仕様は`SPEC_M4af.md`。

- **2026-09-08 M4ag 実機の鳴り続け報告に対するWeb出力緊急停止強化（ローカル検証済み・実スピーカー未確認・未公開）**。
  実スピーカーでの「鳴り続け」を受け、原因をFILTER処理や既存の無出力テストへ断定せず、ライブ出力の最後段を二重化した。ヘッダーに常時表示する`STOP SOUND`を置き、pointerdown時点で、`Esc`とキーボード／支援技術のclickでは同じ経路で、全ノート／待機入力をdrainして既存voice resetを要求する。出力ゲートの将来予約を取り消し、`AudioParam.setValueAtTime(0, currentTime)`で時刻付きのゼロを確定した後、`AudioContext.suspend()`を要求する。次の有効な鍵盤入力は休止完了を待って既存`ensureAudio()`経路でだけ再開する。停止前の旧URLは`m4r`であり、ローカルHTTPサーバーが停止した状態の既読タブだった。これは最新`m4ac`／本変更の原因・有効性を否定も証明もしない環境差として記録する。WASM build、core 76/76、Web 74/74、diff check、localhost配信確認を通過。design-lintは390×844／1440×900でNG 0／WARN 0、44px未満0、STOPのアクセシブル名を確認した。ChromeDriverが無いため`make browser-context-recreate-check`はこのMacで未実行。実機の低音量確認は未実施であり、自動回帰のPASSをスピーカー安全の証明として扱わない。仕様は`SPEC_M4ag.md`。

- **2026-09-08 M4ah Mono / Legato / Glide（ローカル検証済み・実スピーカー未確認・未公開）**。
  ベース／リードを作るときの発音表情として、末尾ID 113 / 114に`VOICE MODE`（POLY / MONO / LEGATO）と`GLIDE TIME`（0〜2秒）を追加した。POLYは従来のvoice選択経路をそのまま通る。MONO / LEGATOは保持中ノートの順序を持ち、最後に押した音を優先、解放時は次に新しい保持音へ戻る。MONOだけは重ね押しでAMP EGを再トリガーし、LEGATOは包絡を保持する。Glideは保持中の音程遷移だけを有限の一次追従で補間し、新しいフレーズは直ちに目標音程から始める。初期値はPOLY / 0秒のため既存patchと既定ゴールデンPCMは不変。UIはPatch toolsから外し、Macroの右にVOICE区画として集約し、390pxではMacroの下へ畳む。core 77/77、WASM、freestanding、Web 74/74を通過。Webの出力未接続実WASM安全ゲートではPOLY→MONO→LEGATO、0.08秒Glide、note-off、panicを一列で実行し、最大peak `0.006703`（上限0.25）、release／panic後0、NaN／Inf 0を確認。design-lintは390×844 / 1440×900でNG 0／WARN 0、44px未満0、最悪コントラスト8.10:1。これは物理出力未接続の回帰であり、実スピーカー、ライブデバイス切替、主観的な再トリガー感／Glide感は未検証。仕様は`SPEC_M4ah.md`。

- **2026-09-08 M4ai MODE選択後のPC鍵盤フォーカス復帰（ローカル検証済み・実スピーカー未確認・未公開）**。
  本人試聴で、MODEをMONOへ切り替えた直後にPC鍵盤が無音になることを確認した。これはDSPのMONO経路ではなく、MODEの`select`がフォーカスを保持し、文字入力／select中のPC鍵盤抑止が発火したUI入力境界だった。MODEだけは値確定後に`blur()`して演奏入力へ戻す。WAVEやFILTER MODEなど、続けて選択を編集するselectは従来のフォーカス保持を変えない。`synth-ui.js`のcache URLを`m4ai`へ更新し、既読タブが旧JavaScriptを使わないようにした。実スピーカーでの再確認は保留。

- **2026-09-08 M4aj Glide中の再アタック除去／VOICES整数表示（ローカル検証済み・実スピーカー未確認・未公開）**。
  本人試聴で、MONOの新しい保持音が再アタックしてからGlideする順序を不自然と判断した。Glideが0より大きいMONOはAMP／FILTER／MODの現在の包絡段階を維持して音程だけ移動し、再アタックはGlide 0のMONOだけに残す。LEGATOは従来どおりGlide値にかかわらず包絡を維持する。既定POLYは変更しない。`VOICES`は最大同時発音数であり、コアは既に整数へ丸めていたがWebの表示／保存値は小数を保持できたため、integer flagを持つ全パラメータを直接入力とpatch復元で整数へ揃える。連続的な声密度は現行VOICESの意味ではなく、必要なら独立した音響パラメータとして検討する。opt-in PCM変更のためengine version 22。core 77/77ではGlide中の包絡維持とGlide 0での再トリガーを個別確認し、freestanding／WASM build、Web 74/74を通過。物理出力未接続の実WASM安全ゲートは最大peak `0.006702`、release／panic後0、NaN／Inf 0。実スピーカーでの再アタック感とGlide感は本人の低音量確認まで未検証。仕様は`SPEC_M4aj.md`。

- **2026-09-08 M4ak 4声Unison Density比較実験（ローカル／実スピーカー確認済み・未公開）**。
  小数の`VOICES`へ離散数と連続量を混在させず、4 unisonの音響密度だけを別概念として比較できるようにした。末尾ID 115 / 116へA/B別`oscUnisonDensity`を追加し、内側2声を常に残して外側2声を左右対称に0〜100%で加える。合計は`1 / sqrt(2 + 2 * density^2)`でエネルギー正規化し、表示だけを`2 + 2 * density^2`の`2.0〜4.0 LAYERS`とする。実際の発音レイヤー数、UNISON、最大同時発音VOICESは整数のまま。4声以外は無効、既定値1は従来4声とビット一致する。BのdensityはB→A FM変調源にも同じように効き、両値は5 msで平滑化する。通常UIへは出さず、既存`?quality=1`のQuality LabにA/B連動rangeを1本だけ追加した。design-web手順で既存のUI密度と44px操作面積を継承し、設計メモ／トークンを先に固定した。1440pxの初回スクリーンショットで説明文の詰まりを検出し、各比較項目を見出し1段＋操作／状態1段へ修正した。engine version 23、パラメータ117。core 78/78、freestanding、WASM build、Web 74/74を通過。4 Insert負荷は平均`326.69 us`／p99 `393.46 us`（基準`1333.5 us`）。密度0→1の実レンダーRMS差は`0.170 dB`、正規化最大誤差`1.09e-7`。物理出力未接続の実WASM安全ゲートでは発音中に2.0→約3.0→4.0へ動かし、最大peak `0.005818`（上限0.25）、release／panic後0、NaN／Inf 0。design-lintは390×844／1440×900でNG 0／WARN 0、44px未満0、最悪コントラスト8.10:1。専用`make browser-context-recreate-check`はこのMacにChromeDriverがなく開始前停止したが、同じ検査ページを既存の隔離Playwright Chromiumで直接実行し、44.1／48／96 kHzの再生成後初期peak 0、release後0、NaN／Inf 0で合格した。本人が実スピーカーでも異常なしと確認済み。2.0／3.0／4.0のどれを既定候補にするかは未決定。仕様は`SPEC_M4ak.md`。

- **2026-09-08 M4al 4段Unison Density／WIDE+（ローカル自動検証済み・実スピーカー未確認・未公開）**。
  本人の「切り替え式がよく、標準は4.0または少し高め、さらにwideもあり」という試聴判断を、`2.0 FOCUS / 3.0 BALANCED / 4.0 FULL / 5.0 WIDE+`の4段へ固定した。4.0は既定値1と従来4声PCMを完全維持する。WIDE+はdensityを`sqrt(1.5)`へ拡張し、4声のまま外側2声のraw gainを内側より約22.5%強めるため、実声数、pan位置、最大同時発音、処理レイヤー数は増えない。A/B連動ボタンは通常UIへ出さず`?quality=1`のQuality Labだけに置き、発音中も既存5 ms平滑化で切り替える。engine version 24、パラメータ117、C ABI不変。core 78/78ではFULL完全一致、正規化最大誤差`7.80e-7`、FULL→WIDE+のside/mid比`0.628412→0.697980`、モノ合成レベル差`-0.348984 dB`を確認した。4 Insert負荷は平均`314.09 us`／p99 `381.67 us`（基準`1333.5 us`）。freestanding、WASM build、Web 74/74を通過し、物理出力未接続の安全ゲートは保持中に2→3→4→5を切り替えて最大peak`0.005818`（上限0.25）、release／panic後0、NaN／Inf 0。WASMは84,273 B（gzip 24,037 B）。design-web手順で比較UIを既存の44px segmented controlと配色へ揃え、設計メモ／トークンを先に更新した。390×844／1440×900の画面監査はNG 0／WARN 0、44px未満0、最悪コントラスト8.10:1。隔離Playwright Chromiumで4.0の初期選択と2.0→5.0のボタン状態を確認し、物理出力を使わないOfflineAudioContext再生成は44.1／48／96 kHzの全rateで新規context初期peak 0、release後0、NaN／Inf 0だった。WIDE+の実スピーカー試聴だけは未確認。仕様は`SPEC_M4al.md`。

- **2026-09-09 M4am OSC Bend Warp比較（ローカル自動検証済み・実スピーカー未確認・未公開）**。
  WT POSとは独立して周期内の読出しを内外へ曲げるA/B別Bend Warpを末尾ID 117 / 118へ追加した。位相写像は`p + 0.85 * amount * sin(2*pi*p) / (2*pi)`で、導関数0.15〜1.85の単調変形に限定し、最大局所速度をwavetable mip選択へ反映する。AはB→A FM後の読出し位相、Bは可聴信号とFM sourceの両方へ同じwarpを通し、Sub / Noiseは変更しない。既定0は旧PCMと完全一致し、発音中の量変更は既存5 ms平滑化、0へ戻す途中も拡張経路を維持して急なバイパスを避ける。通常UIには出さず、`?quality=1`だけにA/B連動`BEND - / OFF / BEND +`を追加した。engine version 25、パラメータ119、C ABI／イベント形式不変。core 79/79では位相の単調性・基準点・OFF完全一致・方向差を確認し、C8固定fixtureのalias指標はunguarded `-18.531704 dB`からguarded `-51.990743 dB`へ`33.459039 dB`改善した。4 Insert負荷は平均`322.40 us`／p99 `392.50 us`（基準`1333.5 us`）。freestanding、WASM build、Web 74/74を通過。物理出力未接続の実WASM安全ゲートは保持中に-75%→0→+75%を切り替え、最大peak`0.005818`（上限0.25）、release／panic後0、NaN／Inf 0。WASMは85,792 B（gzip 24,472 B）。design-web手順で実装前メモ／トークンを固定し、初回1440px画像でQuality Lab説明の重なりを発見して状態文を各操作の下へ整理した。最終390×844／1440×900はNG 0／WARN 0／測定不可0、44px未満0、最悪コントラスト8.10:1。隔離ブラウザで3状態、`aria-pressed`、状態文、OSC A/B波形のアクセシブル名が同期し、OFFへ戻ることを確認した。音色としての有用性、物理スピーカー、Safari／実機タッチは未確認。仕様は`SPEC_M4am.md`。

- **2026-09-09 M4an 通常OSC Warp操作（ローカル自動検証済み・実スピーカー未確認・未公開）**。
  M4amのA/B別Bend Warpを、通常OSC A／Bカードの波形直下へ`OFF / BEND` modeと符号付きAmountとして表示した。modeはAmount 0ならOFF、非0ならBENDとして導出し、保存対象を増やさない。OFFからBENDへ戻すと各OSCで最後に使った非0値を復元し、未使用時は+75%。A/Bは独立操作でき、Quality Labの連動ボタンとも表示同期する。操作はnote停止、voice reset、自動発音、AudioContext開始を行わず、既存5 ms平滑化を使う。DSP、パラメータ119、engine version 25、C ABI、patch schemaはM4amから不変。Web 75/75と物理出力未接続WASM安全ゲートを通過し、最大peak`0.187265`（上限0.25）、release／panic後0、NaN／Inf 0。design-lintは390×844／1440×900でNG 0／WARN 0／測定不可0、44px未満0、ボタン被覆0、最悪コントラスト8.10:1。隔離ブラウザでAのBEND +75%、Bの-50%、Aの前回値復元、A/B両方OFF復帰を確認した。物理スピーカー、Safari／実機タッチ、音色としての有用性は未確認。仕様は`SPEC_M4an.md`。

- **2026-09-09 M4ao Warp Matrix destinations（ローカル自動検証済み・実スピーカー未確認・未公開）**。
  既存6-slot Matrixの末尾destination 14 / 15へ`OSC A Warp` / `OSC B Warp`を追加し、既存0〜13を変更せずA/B別のBend量を11 sourceから動かせるようにした。実効値は`base + source * amount`を`-1..1`へclampし、AはFM後、Bは可聴音とFM sourceの双方で同じ値とalias-aware mipを使う。通常OSCの各Amount横に既存形式の`+ MOD`を追加し、Matrix行と同じslotを編集する。パラメータ数119、C ABI、イベント形式、patch schemaは不変、engine version 26。core 79/79では新destinationのスペクトル差（A 74.44%、B 63.28%）とclamp後のビット一致、既存golden一致を確認。M1c最大構成は平均`313.94 us`／p99`374.04 us`、4 Insert込みは平均`316.12 us`／p99`373.96 us`（基準`1333.5 us`）。freestanding、WASM、Web 75/75を通過し、物理出力未接続の安全ゲートはWarp route切替を含め最大peak`0.187265`（上限0.25）、release／panic後0、NaN／Inf 0。WASMは85,915 B（gzip 24,572 B）。design-web手順で既存Matrix UIだけを増築し、390×844／1440×900はNG 0／WARN 0／測定不可0、44px未満0（110操作）、ボタン被覆0、最悪コントラスト8.10:1。隔離ブラウザでA/Bの`+ MOD`、A dialog、6行すべての末尾2 destination、route適用後の`MOD · 1`、Undoによるroute消去を確認した。物理スピーカー、Safari／実機タッチ、速いLFOや深い変調の音楽的な適量は未確認。仕様は`SPEC_M4ao.md`。

- **2026-09-09 M4ap ASYM Warp mode（ローカル自動検証済み・実スピーカー未確認・未公開）**。
  M4anの通常OSC Warpへ、BENDとは異なる左右非対称の時間変形ASYMを追加した。A/B別modeは末尾ID 119 / 120（0=BEND、1=ASYM）、OFFは従来どおりAmount 0で表す。ASYMの位相写像は`p + 0.85 * amount * p * (1 - p)`で、周期端点を固定し、amount範囲内の導関数を0.15〜1.85に保つ。mode切替は既存control smootherで5 ms補間し、発音停止、voice reset、自動発音、AudioContext開始を行わない。既存BEND／既定patchはmode 0でビット一致し、patch schema 1、C ABI、イベント形式は不変。engine version 27、パラメータ121、平滑化対象14。core 80/80では全amount／mode mixの有限・単調・端点固定、BEND一致、方向差を確認し、C8固定fixtureのASYM alias指標はunguarded `-22.743184 dB`からguarded `-30.489867 dB`へ`7.746683 dB`改善した。M1c最大構成は平均`318.008 us`／p99`392 us`、4 Insert込みは平均`323.936 us`／p99`398.166 us`（基準`1333.5 us`）。freestanding、WASM、Web 75/75を通過し、物理出力未接続の安全ゲートはASYM／BEND切替を含め最大peak`0.187264`（上限0.25）、release／panic後0、NaN／Inf 0。WASMは86,348 B（gzip 24,776 B）。design-web手順で既存のselect、寸法、色、responsive配置を維持し、390×844／1440×900はNG 0／WARN 0／測定不可0、44px未満0（110操作）、ボタン被覆0、最悪コントラスト8.10:1。実ブラウザでOFF→ASYM +75%、`forward`状態、波形のアクセシブル名、5 ms移行メッセージ、UndoによるOFF復帰を確認した。物理スピーカー、Safari／実機タッチ、音色としての有用性は未確認。SYNC系Warpは不連続点を持つため今回含めず、専用のエイリアス対策を伴う別設計とする。仕様は`SPEC_M4ap.md`。

- **2026-09-09 M4aq Band-limited SYNC Warp（ローカル自動検証／本人の低音量実スピーカー試聴済み・未公開）**。
  A/B別Warp modeのID 119 / 120を0..2へ広げ、2=`SYNC`を追加した。ratioは`2^(2 * amount)`の0.25〜4倍で、master周期resetの段差をPolyBLEP補正し、mipは`frequency * max(1, ratio)`で選ぶ。Amount 0は旧PCMを直接通し、mode切替はOSCごとのBEND / ASYM / SYNC one-hot weightを5 ms補間するため、BEND↔SYNC間でASYMを通らない。通常UIは既存selectへSYNCを足し、stretch / compressとratioを状態文・波形ariaへ同期した。engine version 28、パラメータ121、C ABI／イベント形式／patch schema 1は不変。core 81/81ではratio、bypass、正負差、one-hotを固定し、C8固定fixtureのalias指標はnaive `-23.011989 dB`からPolyBLEP `-29.790163 dB`へ`6.778174 dB`改善した。M1c最大構成は平均`326.692 us`／p99`398.541 us`、4 Insert込みは平均`325.242 us`／p99`420.291 us`（基準`1333.5 us`）。freestanding、WASM、Web 76/76を通過。物理出力未接続の44.1／48／96 kHz安全ゲートはSYNCを含むmode切替でも最大peak`0.187264`（上限0.25）、release／panic後0、NaN／Inf 0。WASMは90,087 B（gzip 25,504 B）。390×844／1440×900の監査はNG 0／WARN 0、44px未満0（110操作）、最悪コントラスト8.10:1。実ブラウザでA/B両方に4 modeが存在し、横あふれ0を確認した。本人が実スピーカー低音量試聴でOKと確認済み。全Amount／全presetの網羅、Safari／実機タッチは未確認。仕様は`SPEC_M4aq.md`。

- **2026-09-09 M4ar Serum 2 preset bridge基盤（ローカル変換検証済み・変換音未試聴・未公開）**。
  他社presetを完全互換再生とせず、確認できた数値を既存schema 1 patchへ移すCLI `tools/serum2-preset-bridge.mjs`を追加した。このMac上のSerum 2 `.SerumPreset`から`XferJson` header、JSON metadata、Zstandard圧縮CBOR payloadを確認し、上限付きcontainer parserとCBOR decoderを実装。OSC level / pitch / unison / detune / width、Basic Shapes position、Bend / Asym / Sync、AMP ADSR、一部filter、master / poly / mono-legato / glideを保守的に変換し、単位差は`approximate`、資産・Mod・FX等は`unsupported`へ記録する。factory wavetable / sample / 展開payloadはworkspaceへ複製せず、sourceと同じ出力先、重複出力先、既存ファイルへの暗黙の上書きも拒否する。実factory preset 1件ではmapped 4、approximate 5、unsupported 6のschema 1 patchを`/private/tmp`へ出力し、原本SHA-256 `263446713c2ffdb3ae891be06a17eb393b6a7c2431c04ca895986ddd1517f109`、mtime、sizeの前後一致を確認した。synthetic containerの決定decode、patch検証、壊れたmagic / compression / size / CBOR、危険な出力先のfail-closedは4/4 PASS。Patch Toolsへ44pxの`PRESET BRIDGE`リンクと判断用HTMLを追加し、初回監査で見つかった行送り／source link高を修正後、390×844／1440×900でNG 0／WARN 0、44px未満0、最悪コントラスト8.11:1。現段階はCLI→既存IMPORT JSONで、ブラウザ直読みにしていない。Serum 1 `.fxp`、Massive `.nmsv`、Avengerは実sample／内部形式の確認待ち。変換後の音の近さと物理出力は未試聴。仕様は`SPEC_M4ar.md`、判断用入口は`design/preset-bridge-20260909/index.html`。

- **2026-09-09 M4as Serum 2実preset 3件のローカル試聴セット（自動検証済み・本人試聴待ち・未公開）**。
  Serum 2 factory preset 626件をread-onlyで走査し、Lead `Pianofy`（mapped 10 / approximate 10 / unsupported 3）、Bass `Morpheus`（9 / 10 / 3）、SYNC Bass `Neon Drive`（8 / 10 / 4）を数値patchとmapping reportへ変換した。初回SYNC候補`Perc-O-Lator`は変換後のOSC A/B levelが両方0で無音になるため判断ページから除外し、共有workspace方針により生成済みファイルは削除せずlocal-only記録へ不採用理由を残した。変換patchはsource masterが欠ける場合も含めMASTER 0.20以下、Delay / Reverbを明示OFF、Insert全OFFとし、schema 1 validationを通過。原本preset / wavetable / sample / decode payloadはworkspaceへ複製していない。判断HTMLへ3カード、MAPPED / APPROXIMATE / UNSUPPORTED件数、判断対象／非対象、STOP SOUNDを含む低音量手順、patch／reportリンクを追加した。bridge 5/5、Web 76/76、diff check、全7 URLのHTTP 200を確認。物理出力未接続の実WASM 48 kHzレンダーはvelocity 0.5でPianofy peak `0.016722`、Morpheus `0.010997`、Neon Drive `0.010142`（試験上限0.25）、全件で約5秒後tail 0、panic後0、NaN / Inf 0。390×844／1440×900監査は初回line-height NG 18件を修正後NG 0／WARN 0／測定不可0、44px未満0、最悪コントラスト7.19:1。`Neon Drive`はsource `Hypa.wav`を移せないため原音一致ではなくfallback波形へのSYNC設定の有用性だけを試す。3件の聴感、実スピーカー、Serum 2原音との手動A/Bは本人確認待ち。

- **2026-09-09 M4at Serum 2 modulationの6-slot縮約（ローカル自動検証済み・本人試聴待ち・未公開）**。
  本人がM4as判断資料を問題なしとして次工程を承認したため、Serum 2のModSlotを既存Matrixへ移す保守的adapterを追加した。公式manualで4 Envelope、8 Macro、64 modulation slot、main / aux source、polarity、curveの存在を確認し、このMacの実payloadで`Env0..3`、`Macro0..7`、`ModSlot0..63`を照合した。ENV 1〜3 / Macro 1〜4のlinearな単一sourceと、OSC A/B Level・Position・Warp、Filter Cutoff / Resonance、OSC A Detuneの交差だけをslot番号順に最大6件近似する。Aux、bypass、bipolar、curve、LFO、ENV 4、Macro 5〜8、未知source / destination、容量超過は適用せずreport version 2へroute別理由を残す。Pianofyは4 / 19 route、Morpheusは5 / 18、Neon Driveは1 / 27を変換し、core値は38 / 38 / 24件。件数M/A/Uは10/20/4、9/19/4、8/14/5。patch schema 1、DSP、engine version、通常Synth UIは不変。bridge 6/6、Web 76/76、diff check、判断ページと3組のpatch/reportを含む9 URLのHTTP 200を確認した。物理出力未接続の実WASM 48 kHzレンダーはpeak `0.078927 / 0.017585 / 0.008833`（上限0.25）、late tail 0、panic tail 0、NaN / Inf 0。判断HTMLは390×844／1440×900でNG 0／WARN 0／測定不可0、44px未満0、最悪コントラスト7.19:1。実スピーカー、Serum 2原音とのA/B、route量の音楽的妥当性は未確認。仕様は`SPEC_M4at.md`、local-only出力は`design/preset-bridge-20260909/audition-mod-v1/`。

- **2026-09-09 M4at preset形式案内の修正（ローカル表示確認済み・未公開）**。
  本人の「SerumはJSONではないのでSerumで開けない」という指摘から、出力JSONをSerumへ入れるようにも読める手順を不具合として修正した。判断HTMLに`Serum 2で開く = 元の.SerumPreset`、`SynthEngineで開く = 変換後.synthengine.json`、`Serum → SynthEngineの一方向変換`を明記。各3カードへSerum 2 factory browser内の場所を追加し、`PATCH JSON`を`SYNTHENGINE JSON`へ改名した。変換処理、patch、report、DSP、Synth UIは変更していない。配信marker、diff checkを確認し、390×844／1440×900のdesign-lintはNG 0／WARN 0／測定不可0、44px未満0、最悪コントラスト7.19:1。本人の指摘は共有方針`[外部形式/入出力の明示]`へ抽象化した。

- **2026-09-09 M4at Serum原本downloadの分離（localhost検証済み・Serum実読込未確認・未公開）**。
  本人のdownload結果が`pianofy.synthengine.json`だったスクリーンショットから、形式説明だけではSerum原本を取得できない問題を確認した。3候補カードへ`SERUM ORIGINAL`を追加し、`tools/serve.mjs`が127.0.0.1で待ち受ける場合だけ、固定allowlistのPianofy／Morpheus／Neon Drive原本を元の`.SerumPreset`名でread-only streamする。任意pathを受けず、原本をworkspace／公開buildへ複製しない。`SYNTHENGINE JSON`と`MAPPING`は従来どおり別入口。3件のHTTP 200、Content-Disposition、sizeを確認し、取得内容のSHA-256はインストール済み原本と全件一致（`3472b340…e1b5`／`4b277fec…a7ab`／`506cd824…012a`）、未知presetは404。390×844／1440×900のdesign-lintはNG 0／WARN 0／測定不可0、44px未満0件（17対象）、最悪コントラスト7.19:1で、3 actionの折返しと横あふれなしを画像確認した。8963番を更新版へ再起動済み。Serum 2での実読込と原音試聴は本人確認待ち。

- **2026-09-09 M4au Preset Bridgeの一手試聴導線（localhost自動検証済み・本人試聴待ち・未公開）**。
  固定3候補の各カードへ`SYNTHENGINEで開く`を主操作として追加し、候補ごとの変換済みschema 1 patchを通常Synthへ自動適用する。入力は`bridgePreset=pianofy|morpheus|neon-drive`の固定IDだけで、任意URL／path／JSON本文は受けない。明示候補はautosaveより優先し、成功後は一度だけ使うqueryを履歴から除く。未知IDでは任意取得をせずEPianoを保持する。読み込みだけではAudioContextのresume、note-on、output gate openを行わず、既存どおり鍵盤またはPCキーまでミュートする。`SERUM ORIGINAL / JSON保存 / MAPPING`は補助導線として維持した。Node静的試験を含む全83件はPASS。隔離Chromiumの新規2群で3候補の名前・status・autosave優先・query除去・390px横あふれなし、未知IDの拒否を確認した。Escは既存の全音停止を実行したうえでMod dialogも閉じるようにし、従来UIを含む隔離ブラウザ15群を完走した。判断HTMLは390×844／1440×900でNG 0／WARN 0／測定不可0、44px未満0件（20対象）、最悪コントラスト7.19:1。変換音の近さ、Serum原音とのA/B、実スピーカーは本人確認待ち。仕様は`SPEC_M4au.md`。

- **2026-09-09 M4av Serum 2 source補正／安全Drive近似（ローカル自動検証済み・変更後の実スピーカー未確認・未公開）**。
  本人がSerum 2のPianofy原音を「激しめ」、SynthEngine近似をかなり違うとA/B確認したため、提示されたOSC／MIX／FX／MATRIX画面とインストール済み原本payloadをread-onlyで照合した。従来仮説のsource ID `1..3 = ENV 1..3`は1段ずれており、`2 = ENV 1`、`3 = ENV 2`、`4 = ENV 3`、`5 = ENV 4`、`6 = LFO 1`、`17 = Note#`へ訂正。Noise Level destinationを追加し、PianofyはENV 3→Cutoff、ENV 2→Noise／A Level／B Level、Macro 2→A Warp、Macro 1→Cutoffの6 / 19 routeとなった。`VoiceFilter0.kParamDrive`と明示`kTapeSat`だけを既存Distortionへまとめ、Drive上限0.24、Mix上限0.20、MASTER 0.20以下、Delay／Reverb OFFとした。Fat値はdecoded plainParamsにないため補完していない。旧M4at候補は残し、新しい3組を`audition-mod-fx-v2/`へ生成。件数M/A/UはPianofy 10/26/5、Morpheus 9/18/3、Neon Drive 8/16/5。report version 3へ安全近似profileと上限を追加した。Web 77/77、bridge 7/7、core 81/81、freestandingを通過。実ブラウザの物理出力未接続OfflineAudioContext 48 kHzで3候補を約2.73秒renderし、peakは`0.046893 / 0.013539 / 0.005379`（上限0.25）、初期／release後0、NaN / Inf 0。Pianofyの一発起動はquery除去、初期ミュート、Distortion ON・Drive 0.160・Mix 0.162を実画面で確認した。通常PythonにはPlaywrightがなく既存一括UIスクリプトは開始前停止したため、今回の動的ブラウザ確認は隠しin-app browserで行った。音の近さ、変更後の実スピーカー、Fat、未対応OSC C／Sub／残りFXは未確認。仕様は`SPEC_M4av.md`。

- **2026-09-09 M4aw 3-band EQ品質更新（ローカル自動検証済み・実スピーカー未確認・未公開）**。
  外部preset変換を一旦止め、既存の共有EQを優先して改善した。一次band splitを160 Hz low shelf／1.2 kHz Q 0.75 mid bell／6.8 kHz high shelfの直列biquadへ置換し、LOW / MID / HIGHの発音中操作へ5 ms平滑化を追加。既存ID 99〜102、±18 dB範囲、UI、patch schema 1、121パラメータ、C ABIは維持し、enabled-EQ PCM変更のためengine versionを29へ更新した。EQ BYPASSとEQ ON・全0 dBは旧PCMとサンプル単位で一致。+12 dB試験はLOW 65 Hzで`+11.562 dB`（約1 kHz漏れ`+0.009 dB`）、MID 約1 kHzで`+11.364 dB`（65 Hz／8.4 kHz漏れ`+0.090 / +0.466 dB`）、HIGH 約8.4 kHzで`+8.435 dB`（約1 kHz漏れ`+0.007 dB`）。core 82/82、Web 84/84、freestanding、WASM、Apple arm64 compile-onlyを通過し、全Insert有効fixtureはnative/WASMでビット一致。4 Insert最大負荷は平均`327.809 us`／p99`387.833 us`（基準`1333.5 us`）。物理出力未接続WASM安全ゲートは±18 dB高速切替を44.1／48／96 kHzで行い、全rateの最大peak`0.187264`以下、release後`8.55e-20`以下、panic後0、NaN / Inf 0。WASMは89,889 B（gzip 25,910 B）。EQの音楽的な質感と各帯域の固定周波数の採用は本人の低音量実スピーカー確認待ち。可変frequency / Qとresponse graphは別のUI／schema判断として含めていない。仕様は`SPEC_M4aw.md`。

- **2026-09-10 M4ax Parametric EQ操作／レスポンス表示（ローカル自動検証済み・実スピーカー未確認・未公開）**。
  M4awの3 gainを保ち、末尾ID 121〜124へLow Frequency 40〜600 Hz、Mid Frequency 200〜8,000 Hz / Q 0.25〜8、High Frequency 1,500〜18,000 Hzを追加した。初期値160 Hz / 1.2 kHz / Q 0.75 / 6.8 kHzで旧patch音を維持し、発音中は4値も既存5 ms平滑化を通す。Web FX面はLOW Frequency / Gain、MID Frequency / Q / Gain、HIGH Frequency / Gainの7操作と、DSPと同じRBJ係数・直列順序から160点を算出する20 Hz〜20 kHz／−24〜+24 dB固定軸の`FILTER RESPONSE`を追加。parameter count 125、engine version 30、patch schema 1、C ABI、event ABIは維持した。core 82/82、Web 79/79、freestanding、WASM、Apple arm64 compile-onlyを通過し、可変EQを設定した全Insert fixtureはnative/WASMでビット一致。4 Insert最大負荷は平均`327.175 us`／p99`404.625 us`（基準`1333.5 us`）。物理出力未接続WASM安全ゲートはFrequency / Q / Gainの両端切替を44.1／48／96 kHzで行い、最大peak`0.187265`以下、release後`3.92e-15`以下、panic後0、NaN / Inf 0。WASMは90,411 B（gzip 26,140 B）。390×844／1440×900はNG 0／WARN 0／測定不可0、44px未満0件（75対象）、最悪コントラスト8.10:1。隔離ブラウザでカーブpath 2,208文字、viewBox 480×144、7操作と表示値、console warning/error 0を確認した。ChromeDriver未導入のため`make browser-context-recreate-check`は起動前に停止したが、同じ無出力検査HTMLをin-app browserで実行し、44.1／48／96 kHzの再生成後初期peak 0、release後0、NaN / Inf 0を確認した。音楽的な周波数範囲／Q、物理スピーカー、Safari／実機タッチは本人確認待ち。仕様は`SPEC_M4ax.md`。

## 進め方

### 2026-09-23 UI / UX polish + state safety（公開前検証の記録）

- 本人指定のAstra主担当＋Claude Fable 5.1の読み取り専用レビュー。Claudeへの入力は公開済みa4fce012の隔離コピーに限定。実モデル・成功応答を確認し、提案はソースで独立検証した。
- STOP / blur / Escape / Quality Labのreset種別をVOICES(0)へ修正。ALL(1)は直後に全パラメータを再送するapplyPatchに限定。INITは元から全設定リセット済みであり、今回新たに音響仕様を変更したものではない。
- 数値入力とドラッグをnumeric-control.js、FXの純表示定義をfx-controls.js、非同期読込の世代管理をpatch-load-state.jsへ分離。Preset / INIT / Undoの適用を共通化。単位付き入力、EQ帯域整理、BYPASS表示、モーダルのTab循環を追加。
- 修飾キー誤発音、古い読込応答、失敗したJSONの巻戻し、保存拒否時の起動失敗、初期化によるautosave先行上書き、Worklet障害の通知欠如を修正。keyup識別は修飾キーでも維持する。
- Core 82/82、Web 93/93。実WASMの無出力試験でpanic後の再発音PCMが完全一致。FX抽出の969ケースも旧版とSHA一致。DSP/プリセット/WASM不変、WASM SHA256=1f02dd2886425038dec4a97c5b76280784a7ce7076b109cd82fcdef0f6c41b37。
- 実ブラウザは専用localhost:8974で保存領域を隔離し、390/1440px・直接入力・取消・Undo/Redo・保存/再読込・フォーカス・Delay縦ドラッグを無発音確認。実スピーカー・Safari・実機タッチは未確認。
- 判断用入口：`design/polish-20260923/index.html`。公開前の確認用：`http://127.0.0.1:8963/shells/web/synth.html?polish=20260923&tab=fx`。この検証時点では未コミット・未push・未デプロイ。既存reports/・research/は未変更。

思考・設計・検証は Claude、実装は Codex へ委譲（`_claude-rules/codex-delegation.md`）。
着手前に `_claude-rules/dev-preferences.md` の方針リストを読む。削除・移動は本人承認フロー。
