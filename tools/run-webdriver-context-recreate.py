#!/usr/bin/env python3
"""Run the OfflineAudioContext browser check through an existing ChromeDriver."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def request_json(base_url: str, path: str, method: str = "GET", payload: object | None = None) -> object:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(
        f"{base_url}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urlopen(request, timeout=5) as response:
            return json.load(response)
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"WebDriver {method} {path} returned {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"WebDriver {method} {path} was unreachable: {error.reason}") from error


def value(response: object) -> object:
    if not isinstance(response, dict) or "value" not in response:
        raise RuntimeError(f"malformed WebDriver response: {response!r}")
    return response["value"]


def wait_for_driver(base_url: str, deadline: float) -> None:
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            status = value(request_json(base_url, "/status"))
            if isinstance(status, dict) and status.get("ready"):
                return
        except RuntimeError as error:
            last_error = error
        time.sleep(0.1)
    raise RuntimeError(f"ChromeDriver did not become ready: {last_error}")


def execute(base_url: str, session_id: str, script: str) -> object:
    return value(
        request_json(
            base_url,
            f"/session/{session_id}/execute/sync",
            "POST",
            {"script": script, "args": []},
        )
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--driver", required=True)
    parser.add_argument("--browser", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile-dir", required=True)
    parser.add_argument("--driver-log", required=True)
    parser.add_argument("--timeout-seconds", type=float, default=60)
    parser.add_argument("--driver-port", type=int, default=9515)
    args = parser.parse_args()

    base_url = f"http://127.0.0.1:{args.driver_port}"
    session_id: str | None = None
    driver_log = Path(args.driver_log)
    driver_log.parent.mkdir(parents=True, exist_ok=True)
    with driver_log.open("wb") as log_file:
        driver = subprocess.Popen(
            [args.driver, f"--port={args.driver_port}"],
            stdout=subprocess.DEVNULL,
            stderr=log_file,
        )
        try:
            wait_for_driver(base_url, time.monotonic() + 10)
            capabilities = {
                "capabilities": {
                    "alwaysMatch": {
                        "browserName": "chrome",
                        "goog:chromeOptions": {
                            "binary": args.browser,
                            "args": [
                                "--headless=new",
                                "--no-sandbox",
                                "--disable-gpu",
                                "--disable-dev-shm-usage",
                                "--disable-background-networking",
                                "--disable-component-update",
                                "--disable-default-apps",
                                "--no-default-browser-check",
                                "--no-first-run",
                                "--mute-audio",
                                f"--user-data-dir={args.profile_dir}",
                            ],
                        },
                    }
                }
            }
            created = value(request_json(base_url, "/session", "POST", capabilities))
            if not isinstance(created, dict) or not isinstance(created.get("sessionId"), str):
                raise RuntimeError(f"ChromeDriver did not return a session id: {created!r}")
            session_id = created["sessionId"]
            request_json(base_url, f"/session/{session_id}/url", "POST", {"url": args.url})

            deadline = time.monotonic() + args.timeout_seconds
            while time.monotonic() < deadline:
                status = execute(
                    base_url,
                    session_id,
                    "return document.body?.dataset.status || 'running';",
                )
                if status in ("pass", "fail"):
                    detail = execute(
                        base_url,
                        session_id,
                        "return document.querySelector('#details')?.textContent || '';",
                    )
                    if status == "pass":
                        print("WebDriver observed data-status=pass")
                        return 0
                    raise RuntimeError(f"browser page reported fail: {detail}")
                time.sleep(0.1)
            raise RuntimeError(f"browser page did not finish within {args.timeout_seconds:g} seconds")
        except RuntimeError as error:
            print(str(error), file=sys.stderr)
            return 1
        finally:
            if session_id:
                try:
                    request_json(base_url, f"/session/{session_id}", "DELETE")
                except RuntimeError:
                    pass
            driver.terminate()
            try:
                driver.wait(timeout=5)
            except subprocess.TimeoutExpired:
                driver.kill()
                driver.wait()


if __name__ == "__main__":
    raise SystemExit(main())
