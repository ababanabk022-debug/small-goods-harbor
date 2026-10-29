"""Start the bundled island website on localhost and open it in a browser."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
HOST = "127.0.0.1"
PREFERRED_PORTS = (5207, 5198)
SITE_MARKER = "小岛 · 自由漫游".encode("utf-8")


def site_is_ready(port: int) -> bool:
    url = f"http://{HOST}:{port}/"
    try:
        with urllib.request.urlopen(url, timeout=0.8) as response:
            return response.status == 200 and SITE_MARKER in response.read(32768)
    except (OSError, urllib.error.URLError):
        return False


def port_is_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((HOST, port))
        except OSError:
            return False
    return True


def choose_port() -> tuple[int, bool]:
    for port in PREFERRED_PORTS:
        if site_is_ready(port):
            return port, True
        if port_is_available(port):
            return port, False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((HOST, 0))
        return probe.getsockname()[1], False


def start_server(port: int) -> None:
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", HOST,
         "--directory", str(DIST)],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
        close_fds=True,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-browser", action="store_true", help="Only start and verify the server")
    args = parser.parse_args()

    if not (DIST / "index.html").is_file():
        print(f"Missing website: {DIST / 'index.html'}", file=sys.stderr)
        return 1

    try:
        port, running = choose_port()
        if not running:
            start_server(port)
            for _ in range(40):
                if site_is_ready(port):
                    break
                time.sleep(0.15)
            else:
                print("The local website did not become ready.", file=sys.stderr)
                return 1
    except OSError as exc:
        print(f"Could not start the local website: {exc}", file=sys.stderr)
        return 1

    url = f"http://{HOST}:{port}/?local={int(time.time())}"
    print(url)
    if not args.no_browser:
        if not webbrowser.open(url, new=2) and os.name == "nt":
            os.startfile(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
