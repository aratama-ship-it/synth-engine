# SPEC M4z — WebDriverによる非同期ブラウザ安全検査の完了待機

## 目的

M4y初回CIで、Chrome CLIの`--dump-dom`が`OfflineAudioContext`の非同期render完了前にDOMを出力することを確認した。検査内容を弱めず、ページの完了状態を確実に取得する。

## 実行経路

1. 既存のbash入口がWASM、Chrome、ChromeDriverを検出し、127.0.0.1の一時HTTPサーバーと空のChrome profileを作る。
2. `tools/run-webdriver-context-recreate.py`がPython標準ライブラリだけでChromeDriver sessionを作る。
3. Chromeにはheadless・muteと既存のbackground networking停止引数を渡す。
4. ページ遷移後、WebDriverが`document.body.dataset.status`を最大60秒pollする。
5. `pass`だけを成功にし、`fail`、未完了、driver／browser起動失敗はCIを失敗させる。終了時はsession、driver、一時profile、HTTP serverを終了する。

## 安全条件

- AudioContextや物理スピーカーへ接続しないOfflineAudioContextページをそのまま使う。Chromeにも`--mute-audio`を渡す。
- npm／pip installはしない。Python標準ライブラリ、runner既存のChrome、ChromeDriverだけを使う。
- user data directoryは一時profileだけで、テスト後に消す。既存プロフィール、公開artifact、音源データを変更しない。

## 検証境界

- ChromeDriver／Chromeのrunner提供有無と実ページの合格は、修正commitのGitHub Actionsログで確認するまで未確定とする。
- ライブContext close、デバイス切替、実スピーカー、聴感は対象外。
