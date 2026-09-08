# SPEC M4y — Browser Context再生成のCI固定

## 目的

M4xの実ブラウザ・無出力検査を、GitHub Pages workflowのビルド段階で毎回実行する。音源変更が保持音やContext再生成の安全条件を壊した場合、公開artifactの組立前に失敗させる。

## 実行経路

1. `WASM_CLANG=clang++ make wasm`で現行WASMを生成する。
2. `make test`と`node --test shells/web/tests/index.mjs`が成功した後、`make browser-context-recreate-check`を実行する。
3. `tools/test-browser-context-recreate.sh`が127.0.0.1の一時HTTPサーバーを起動し、`shells/web/tests/context-recreate-safety.html`をChrome headlessで開く。
4. ページの`data-status="pass"`だけを合格とする。タイムアウト、WASM未生成、Chrome未検出、ページの失敗はCI失敗にする。

## 安全条件

- Chromeには`--headless=new`と`--mute-audio`を渡す。ページは`OfflineAudioContext.destination`だけへ接続する。
- Chrome profileは一時ディレクトリで作り、終了時に削除する。テストデータ・ユーザープロフィール・公開ファイルは変更しない。
- 追加のnpm／Pythonパッケージは導入しない。GitHub-hosted Ubuntu runnerの既存Chromeを検出して使う。

## 検証境界

- CI上の実行結果は、初回のpush後にGitHub Actionsログで確認するまで未確認とする。
- ライブ`AudioContext.close()`、オーディオデバイス変更、実スピーカー出力、聴感は対象外。
