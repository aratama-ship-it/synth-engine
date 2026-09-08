#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${BROWSER_TEST_PORT:-8964}"
url="http://127.0.0.1:${port}/shells/web/tests/context-recreate-safety.html?ci=1"
chrome_bin="${CHROME_BIN:-}"
driver_bin="${CHROMEDRIVER_BIN:-}"
server_pid=""
profile_dir=""
driver_log=""

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

if [ -n "$driver_bin" ] && [ ! -x "$driver_bin" ] && command -v "$driver_bin" >/dev/null 2>&1; then
  driver_bin="$(command -v "$driver_bin")"
fi

if [ -z "$driver_bin" ]; then
  for candidate in chromedriver chromium-driver; do
    if [ -x "$candidate" ]; then
      driver_bin="$candidate"
      break
    fi
    if command -v "$candidate" >/dev/null 2>&1; then
      driver_bin="$(command -v "$candidate")"
      break
    fi
  done
fi

if [ -z "$driver_bin" ] || [ ! -x "$driver_bin" ]; then
  echo "no ChromeDriver found; set CHROMEDRIVER_BIN" >&2
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

driver_log="$profile_dir/chromedriver.stderr.log"
if ! python3 "$project_root/tools/run-webdriver-context-recreate.py" \
  --driver "$driver_bin" \
  --browser "$chrome_bin" \
  --url "$url" \
  --profile-dir "$profile_dir" \
  --driver-log "$driver_log" \
  --timeout-seconds 60; then
  echo "browser context recreate safety failed" >&2
  [ -f "$driver_log" ] && cat "$driver_log" >&2
  exit 1
fi

echo "browser context recreate safety: PASS (OfflineAudioContext, muted, no physical output)"
