# SPEC M4y — Browser Context再生成のCI固定

## 目的

M4xの実ブラウザ・無出力検査を、GitHub Pages workflowのビルド段階で毎回実行する。音源変更が保持音やContext再生成の安全条件を壊した場合、公開artifactの組立前に失敗させる。

## 実行経路

1. `WASM_CLANG=clang++ make wasm`で現行WASMを生成する。
2. `make test`と`node --test shells/web/tests/index.mjs`が成功した後、`make browser-context-recreate-check`を実行する。
3. `tools/test-browser-context-recreate.sh`が127.0.0.1の一時HTTPサーバーを起動し、既存ChromeDriver経由で`shells/web/tests/context-recreate-safety.html`をChrome headlessで開く。
4. WebDriverがページの`data-status="pass"`を完了まで待って確認した場合だけを合格とする。タイムアウト、WASM／Chrome／ChromeDriverの未検出、ページの失敗はCI失敗にする。

## 安全条件

- Chromeには`--headless=new`と`--mute-audio`を渡す。ページは`OfflineAudioContext.destination`だけへ接続する。CLIの即時DOM出力で非同期renderの完了を推測せず、WebDriverで状態をpollする。
- Chrome profileは一時ディレクトリで作り、終了時に削除する。テストデータ・ユーザープロフィール・公開ファイルは変更しない。
- 追加のnpm／Pythonパッケージは導入しない。Python標準ライブラリとGitHub-hosted Ubuntu runnerの既存Chrome／ChromeDriverを使う。

## 検証境界

- GitHub Actions run `34205807512`（commit `17fd7ea`）でbuild、WebDriver経由の`data-status="pass"`、Pages deployまで成功した。runner image更新後も、次の実行ログで同じ条件を確認する。
- ライブ`AudioContext.close()`、オーディオデバイス変更、実スピーカー出力、聴感は対象外。
