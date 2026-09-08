#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${BROWSER_TEST_PORT:-8964}"
url="http://127.0.0.1:${port}/shells/web/tests/context-recreate-safety.html?ci=1"
chrome_bin="${CHROME_BIN:-}"
server_pid=""
profile_dir=""
chrome_log=""

cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  if [ -n "$profile_dir" ] && [ -d "$profile_dir" ]; then
    rm -rf "$profile_dir"
  fi
}
trap cleanup EXIT INT TERM

if [ ! -s "$project_root/build/synth_engine.wasm" ]; then
  echo "missing build/synth_engine.wasm; run 'make wasm WASM_CLANG=...' first" >&2
  exit 1
fi

if [ -n "$chrome_bin" ] && [ ! -x "$chrome_bin" ] && command -v "$chrome_bin" >/dev/null 2>&1; then
  chrome_bin="$(command -v "$chrome_bin")"
fi

if [ -z "$chrome_bin" ]; then
  for candidate in \
    google-chrome google-chrome-stable chromium chromium-browser \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if [ -x "$candidate" ]; then
      chrome_bin="$candidate"
      break
    fi
    if command -v "$candidate" >/dev/null 2>&1; then
      chrome_bin="$(command -v "$candidate")"
      break
    fi
  done
fi

if [ -z "$chrome_bin" ] || [ ! -x "$chrome_bin" ]; then
  echo "no Chromium-compatible browser found; set CHROME_BIN" >&2
  exit 1
fi

profile_dir="$(mktemp -d "${TMPDIR:-/tmp}/synth-engine-browser.XXXXXX")"
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$project_root" >/dev/null 2>&1 &
server_pid="$!"

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent "http://127.0.0.1:${port}/shells/web/tests/context-recreate-safety.html" >/dev/null; then
    break
  fi
  if [ "$attempt" = 10 ]; then
    echo "local browser-test server did not become reachable" >&2
    exit 1
  fi
  sleep 1
done

chrome_args=(
  "$chrome_bin"
  --headless=new
  --no-sandbox
  --disable-gpu
  --disable-dev-shm-usage
  --disable-background-networking
  --disable-component-update
  --disable-default-apps
  --no-default-browser-check
  --no-first-run
  --mute-audio
  --virtual-time-budget=30000
  --user-data-dir="$profile_dir"
  --dump-dom
  "$url"
)
chrome_log="$profile_dir/chrome.stderr.log"
run_chrome() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 60s "${chrome_args[@]}"
  else
    "${chrome_args[@]}"
  fi
}
if ! dom="$(run_chrome 2>"$chrome_log")"; then
  echo "headless browser failed while running context recreation safety" >&2
  [ -f "$chrome_log" ] && cat "$chrome_log" >&2
  exit 1
fi

if ! grep -Fq 'data-status="pass"' <<<"$dom"; then
  echo "browser context recreate safety did not report pass" >&2
  [ -f "$chrome_log" ] && cat "$chrome_log" >&2
  printf '%s\n' "$dom" >&2
  exit 1
fi

echo "browser context recreate safety: PASS (OfflineAudioContext, muted, no physical output)"
