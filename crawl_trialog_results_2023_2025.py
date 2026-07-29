#!/usr/bin/env python3
"""Crawl the V-Card/Viernheim triathlon results for 2023-2025.

The five result tables are combined into one CSV with a leading ``Year``
column. Gender is read from the site's icon metadata, but images, media,
certificate links, photo links, and URLs are not exported.

Usage:
    python crawl_trialog_results_2023_2025.py [-o results.csv]

Dependencies:
    requests
    beautifulsoup4
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import time
from collections import OrderedDict
from pathlib import Path
from typing import Iterable

import requests
from bs4 import BeautifulSoup, Tag
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE_URL = "https://www.trialogevent.de/results/"
RACES: tuple[tuple[int, int], ...] = (
    (2023, 200),
    (2024, 217),
    (2025, 233),
)

MEDIA_TAGS = {
    "img", "picture", "video", "audio", "source", "track", "canvas",
    "svg", "iframe", "object", "embed",
}
DETAIL_KEYS = (
    "Swim", "Trans1", "Trans1_Swim", "Bike1", "Bike_Finish", "Bike",
    "Trans2", "Trans2_Bike", "Run1", "Run2", "Run3", "Run4", "Run",
    "Finish",
)
DETAIL_RE = re.compile(
    r"^(" + "|".join(map(re.escape, sorted(DETAIL_KEYS, key=len, reverse=True)))
    + r")\s*:\s*(.+?)\s*$",
    re.IGNORECASE,
)


def build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=4,
        connect=4,
        read=4,
        backoff_factor=1.0,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset({"GET"}),
    )
    session.mount("https://", HTTPAdapter(max_retries=retry))
    session.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (compatible; race-results-csv/1.1)",
            "Accept": "text/html,application/xhtml+xml",
            "Accept-Language": "de,en;q=0.8",
        }
    )
    return session


def clean_text(node: Tag) -> str:
    """Return visible text while removing all media and link destinations."""
    clone = BeautifulSoup(str(node), "html.parser")
    for tag in clone.find_all(MEDIA_TAGS):
        tag.decompose()
    for link in clone.find_all("a"):
        link.unwrap()
    return " ".join(clone.get_text(" ", strip=True).split())


def extract_gender(cell: Tag) -> str:
    """Read gender from icon metadata without exporting the icon or its URL."""
    clues: list[str] = [clean_text(cell)]

    for node in (cell, *cell.find_all(True)):
        for attr in (
            "alt", "title", "aria-label", "data-original-title",
            "data-title", "data-gender", "src",
        ):
            value = node.get(attr)
            if value:
                clues.append(str(value))
        classes = node.get("class")
        if classes:
            clues.extend(str(value) for value in classes)

    text = " ".join(clues).casefold()
    text = re.sub(r"[_./\\-]+", " ", text)

    patterns = (
        ("nonbinary", ("nonbinär", "nonbinaer", "nonbinary", "non binary", "genderless")),
        ("mixed", ("mixed", "divers", "diverse", "intersex")),
        ("female", ("weiblich", "female", "woman", "frau", "venus", "gender f", "gender w")),
        ("male", ("männlich", "maennlich", "male", "man", "mann", "mars", "gender m")),
    )
    for result, terms in patterns:
        if any(term in text for term in terms):
            return result

    visible = clean_text(cell).strip().casefold()
    return {
        "m": "male",
        "w": "female",
        "f": "female",
        "x": "mixed",
        "d": "mixed",
        "n": "nonbinary",
        "♂": "male",
        "♀": "female",
    }.get(visible, "")


def normalize_header(text: str) -> str:
    aliases = {
        "Gender": "Gender",
        "Stnr": "Startnummer",
        "AK": "Altersklasse",
        "Rang": "AK_Rang",
        "Schwimm": "Schwimmen",
        "WZ1": "Wechsel_1",
        "Rad": "Rad",
        "WZ2": "Wechsel_2",
        "Lauf": "Lauf",
    }
    text = " ".join(text.split())
    return aliases.get(text, text)


def find_results_table(soup: BeautifulSoup) -> Tag:
    candidates: list[tuple[int, Tag]] = []
    for table in soup.find_all("table"):
        text = clean_text(table).casefold()
        score = sum(
            term in text
            for term in ("platz", "stnr", "name", "totalzeit", "schwimm", "rad", "lauf")
        )
        candidates.append((score, table))

    if not candidates or max(candidates, key=lambda item: item[0])[0] < 4:
        raise RuntimeError("Could not identify the results table on the page")
    return max(candidates, key=lambda item: item[0])[1]


def extract_headers(table: Tag) -> list[str]:
    thead = table.find("thead")
    row = thead.find("tr") if isinstance(thead, Tag) else table.find("tr")
    if not isinstance(row, Tag):
        raise RuntimeError("Results table has no header row")

    headers = [
        normalize_header(clean_text(cell))
        for cell in row.find_all(["th", "td"], recursive=False)
    ]
    return [header or f"column_{index + 1}" for index, header in enumerate(headers)]


def detail_fields(node: Tag) -> dict[str, str]:
    details: dict[str, str] = {}
    for raw_line in node.get_text("\n", strip=True).splitlines():
        line = " ".join(raw_line.split())
        match = DETAIL_RE.match(line)
        if match:
            key = next(
                candidate
                for candidate in DETAIL_KEYS
                if candidate.casefold() == match.group(1).casefold()
            )
            details[key] = match.group(2)
    return details


def nearby_details(row: Tag) -> dict[str, str]:
    details = detail_fields(row)
    if details:
        return details

    sibling = row.find_next_sibling()
    checked = 0
    while isinstance(sibling, Tag) and checked < 3:
        if sibling.name == "tr" and sibling.find_all("td", recursive=False):
            cells = sibling.find_all("td", recursive=False)
            if len(cells) == 1 or sibling.get("class"):
                details.update(detail_fields(sibling))
            else:
                break
        else:
            details.update(detail_fields(sibling))
        sibling = sibling.find_next_sibling()
        checked += 1

    if not details and isinstance(row.parent, Tag):
        details.update(detail_fields(row.parent))
    return details


def extract_rows(table: Tag, headers: list[str], year: int) -> list[OrderedDict[str, str | int]]:
    body = table.find("tbody") or table
    rows: list[OrderedDict[str, str | int]] = []
    seen: set[tuple[str, ...]] = set()

    for tr in body.find_all("tr", recursive=False):
        cells = tr.find_all("td", recursive=False)
        if not cells:
            continue

        values: list[str] = []
        for index, cell in enumerate(cells):
            header = headers[index] if index < len(headers) else ""
            values.append(extract_gender(cell) if header.casefold() == "gender" else clean_text(cell))

        # Ignore expandable/detail rows rather than treating them as athletes.
        if len(values) < max(3, len(headers) // 2):
            continue

        values = values[:len(headers)]
        values += [""] * (len(headers) - len(values))

        signature = tuple(values)
        if signature in seen:
            continue
        seen.add(signature)

        record: OrderedDict[str, str | int] = OrderedDict()
        record["Year"] = year
        record.update(zip(headers, values))
        for key, value in nearby_details(tr).items():
            record[f"Split_{key}"] = value
        rows.append(record)

    if not rows:
        raise RuntimeError("Results table found, but no participant rows were extracted")
    return rows


def crawl_race(session: requests.Session, year: int, event_id: int) -> list[OrderedDict[str, str | int]]:
    # k=1 preserves the same first competition used in the original request.
    params = {"id": event_id, "k": 1, "c": "Platz"}
    response = session.get(BASE_URL, params=params, timeout=60)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    table = find_results_table(soup)
    headers = extract_headers(table)
    return extract_rows(table, headers, year)


def write_csv(rows: Iterable[dict[str, str | int]], output: Path) -> int:
    materialized = list(rows)
    fields: list[str] = []
    for row in materialized:
        for key in row:
            if key not in fields:
                fields.append(key)

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(materialized)
    return len(materialized)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "-o", "--output",
        default="trialogevent_results_2023_2025.csv",
        help="combined CSV output path",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.5,
        help="seconds to wait between pages (default: 0.5)",
    )
    args = parser.parse_args()

    if args.delay < 0:
        parser.error("--delay must be non-negative")

    session = build_session()
    all_rows: list[OrderedDict[str, str | int]] = []

    try:
        for index, (year, event_id) in enumerate(RACES):
            rows = crawl_race(session, year, event_id)
            all_rows.extend(rows)
            print(f"{year}: {len(rows)} rows", file=sys.stderr)
            if index + 1 < len(RACES) and args.delay:
                time.sleep(args.delay)

        count = write_csv(all_rows, Path(args.output))
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    finally:
        session.close()

    print(f"Wrote {count} rows to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
