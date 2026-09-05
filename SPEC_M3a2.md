# SPEC M3a-2 — ゴールデンをハッシュ化し、FMA無効を既定にする

対象: `tests/` と `Makefile`／`shells/apple/build.sh`（コンパイル指定）。前提: M3a 完了（57テスト）。

## 直す問題は2つ

### 問題1: ゴールデンが `/tmp/` にある（テストが再現しない）

`tests/test_main.cpp` は基準音を `/tmp/golden_*.wav` `/tmp/g2_*.wav` `/tmp/g3_*.wav` `/tmp/g4_*.wav`
`/tmp/g6_*.wav` から読んでいる。これらは Claude が委譲のたびに手で作った一時ファイルで、
**再起動すると消え、新規 clone では存在しない**。該当は テスト22・35・39・42・50 の5件。
README に「clone して `make test`」と書いているのに、**別の環境では5件が落ちる。**

### 問題2: FMA が有効だと、ネイティブと wasm で音が一致しない

積和融合命令（FMA）が有効だと丸めが変わり、FM を使う音色で **最大 −83.7 dBFS の差**が出ていた。
`-ffp-contract=off` を付けると **8プリセット全てでビット一致**する（2026-09-06 Claude 実測）。
処理時間は 236→294 µs（p99 364 µs、期限 2667 µs の 14%）で余裕は十分。

## やること

### 1. コンパイル指定（Claude が適用済み。壊さないこと）

`Makefile` の `CXXFLAGS` と `shells/apple/build.sh` の4箇所に **`-ffp-contract=off`** が入っている。
**この指定は消さない。** 理由のコメントも残す。

### 2. ゴールデンをハッシュに置き換える

`/tmp` のファイルを読む方式をやめ、**レンダー結果のハッシュを `tests/test_main.cpp` 内の定数と比べる**方式にする。

- ハッシュ関数は**自作**（FNV-1a 64bit で十分）。`tests/` 内に置く。core は変更しない。
- 対象は各ゴールデンの **PCM サンプル列全体**（ヘッダを含めない。`float` のビット列をそのままバイト列として食わせる）。
- 失敗時は **期待値と実測値の両方を16進で表示**する（`expected=0x... got=0x...`）。
- ★**まず現在のビルド（`-ffp-contract=off` 適用済み）で全ゴールデンのハッシュを算出し、それを定数として埋め込む。**
  埋め込んだあと、`make test` が **57/57 PASS** になること。
- 定数のすぐ上に、次の内容のコメントを置く:
  「この値は `-ffp-contract=off` を付けた状態のもの。コンパイル指定や DSP を変えると当然変わる。
   意図した変更なら、変更内容を commit メッセージに書いたうえでこの値を更新する。」
- テスト名と表示は今の意味を保つ（「M0a のビット一致」等）。**比較対象のプリセットとフィクスチャは変えない。**

### 3. 一時ファイルへの依存を完全に断つ

`tests/test_main.cpp` から `/tmp/` を含む文字列が**1つも無くなる**こと。

## 完了条件

- `make test` が **57/57 PASS**
- `grep -c "/tmp/" tests/test_main.cpp` が **0**
- `make core-freestanding-check` PASS、`make wasm WASM_CLANG=/opt/homebrew/opt/llvm/bin/clang` 成功
- **別ディレクトリへ clone しても 57/57 PASS になること**（`git clone` して `make test` を実際に試して確認する）
- `docs_BUILD.md` に「ゴールデンはハッシュ定数。更新するときの手順」と「`-ffp-contract=off` は必須」を追記
- 埋め込んだハッシュ値の一覧を報告する

## やらないこと

- `core/` の変更。テストの判定内容（何を比べるか）の変更。`shells/` `tools/` `design/` `presets/` の変更。
- ファイルの削除・移動。
