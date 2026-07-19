#!/usr/bin/env python3
"""Static launch-site preflight with no third-party dependencies."""

from __future__ import annotations

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlparse


class SiteParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.title_parts: list[str] = []
        self.in_title = False
        self.h1_count = 0
        self.description = ""
        self.ids: set[str] = set()
        self.local_refs: list[tuple[str, str]] = []
        self.hash_links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if tag == "title":
            self.in_title = True
        if tag == "h1":
            self.h1_count += 1
        if data.get("id"):
            self.ids.add(data["id"] or "")
        if tag == "meta" and data.get("name", "").lower() == "description":
            self.description = (data.get("content") or "").strip()
        for attr in ("src", "href"):
            value = data.get(attr)
            if not value:
                continue
            if value.startswith("#"):
                self.hash_links.append(value[1:])
            elif not urlparse(value).scheme and not value.startswith(("//", "mailto:", "tel:")):
                self.local_refs.append((tag, value))

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    parser.add_argument("--entry", default="index.html")
    args = parser.parse_args()
    root = args.project.resolve()
    entry = root / args.entry
    errors: list[str] = []
    warnings: list[str] = []

    if not entry.is_file():
        print(f"ERROR missing entry file: {entry}")
        return 2

    text = entry.read_text(encoding="utf-8")
    scan = SiteParser()
    scan.feed(text)
    title = "".join(scan.title_parts).strip()

    if not title:
        errors.append("missing document title")
    if not scan.description:
        errors.append("missing meta description")
    if scan.h1_count != 1:
        errors.append(f"expected exactly one H1, found {scan.h1_count}")

    for anchor in scan.hash_links:
        if anchor and anchor not in scan.ids:
            errors.append(f"broken internal anchor: #{anchor}")

    for tag, raw_ref in scan.local_refs:
        ref = unquote(raw_ref.split("?", 1)[0].split("#", 1)[0])
        if not ref or ref == "/":
            continue
        target = root / ref.lstrip("/") if ref.startswith("/") else entry.parent / ref
        if not target.exists():
            errors.append(f"missing local asset from <{tag}>: {raw_ref}")

    forbidden = {
        "lorem ipsum": "placeholder copy",
        "example.com": "example domain",
        "your business": "generic placeholder",
        "todo": "unfinished TODO",
    }
    lowered = text.lower()
    for needle, label in forbidden.items():
        if needle in lowered:
            warnings.append(f"found {label}: {needle!r}")
    if re.search(r"(?:api[_-]?key|token|password)\s*[:=]\s*['\"][^'\"]{8,}", text, re.I):
        errors.append("possible client-side secret")

    print(f"entry: {entry}")
    print(f"title: {title or '(missing)'}")
    print(f"h1: {scan.h1_count}; local refs: {len(scan.local_refs)}; anchors: {len(scan.hash_links)}")
    for item in warnings:
        print(f"WARNING {item}")
    for item in errors:
        print(f"ERROR {item}")
    if errors:
        return 1
    print("PASS static preflight")
    return 0


if __name__ == "__main__":
    sys.exit(main())
