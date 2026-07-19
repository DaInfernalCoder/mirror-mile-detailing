#!/usr/bin/env python3
"""Verify that a hostname serves expected HTML over HTTPS."""

from __future__ import annotations

import argparse
import ssl
import sys
import urllib.error
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("hostname")
    parser.add_argument("expected", nargs="?", default="")
    parser.add_argument("--timeout", type=float, default=15)
    args = parser.parse_args()
    url = f"https://{args.hostname.strip().rstrip('/')}"
    request = urllib.request.Request(url, headers={"User-Agent": "make-gmb/1.0"})

    try:
        with urllib.request.urlopen(request, timeout=args.timeout, context=ssl.create_default_context()) as response:
            body = response.read(2_000_000).decode("utf-8", "replace")
            final_url = response.geturl()
            status = response.status
            content_type = response.headers.get("content-type", "")
    except (urllib.error.URLError, TimeoutError, ssl.SSLError) as exc:
        print(f"FAIL {url}: {exc}")
        return 1

    failures: list[str] = []
    if status < 200 or status >= 400:
        failures.append(f"unexpected HTTP status {status}")
    if "html" not in content_type.lower():
        failures.append(f"unexpected content type {content_type!r}")
    if args.expected and args.expected.lower() not in body.lower():
        failures.append(f"expected text not found: {args.expected!r}")

    print(f"requested: {url}")
    print(f"final: {final_url}")
    print(f"status: {status}; content-type: {content_type}")
    if failures:
        for failure in failures:
            print(f"FAIL {failure}")
        return 1
    print("PASS live HTTPS check")
    return 0


if __name__ == "__main__":
    sys.exit(main())
