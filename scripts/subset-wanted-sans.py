"""Build the two Wanted Sans display subsets required by the design spec.

The Korean set is the 2,350 Hangul syllables encoded by KS X 1001 rows
0xB0A1-0xC8FE. The Latin set follows Wanted Sans' upstream Latin split ranges.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path


UPSTREAM_SHA256 = "4259e7e9a172e634c2cb419d793b84148990316341e910443e5d10965b2c8f16"

PINNED_TOOLCHAIN = (
    ("fonttools", "4.63.0"),
    ("brotli", "1.2.0"),
)

LATIN_RANGES = (
    (0x0000, 0x024F),
    (0x0259, 0x0259),
    (0x1E00, 0x1EFF),
    (0x2000, 0x209F),
    (0x20A0, 0x20CF),
    (0x2122, 0x2122),
    (0x2190, 0x2199),
    (0x2212, 0x2212),
    (0x2215, 0x2215),
    (0x2605, 0x2606),
    (0x2661, 0x2661),
    (0x2665, 0x2665),
    (0x2669, 0x266C),
    (0x2C7C, 0x2C7C),
    (0xFEFF, 0xFEFF),
    (0xFFFD, 0xFFFD),
)


def ksx1001_hangul_codepoints() -> set[int]:
    characters = {
        bytes((lead, trail)).decode("euc_kr")
        for lead in range(0xB0, 0xC9)
        for trail in range(0xA1, 0xFF)
    }
    codepoints = {ord(character) for character in characters}
    if len(codepoints) != 2_350:
        raise RuntimeError(f"Expected 2,350 KS X 1001 syllables, got {len(codepoints)}")
    return codepoints


def latin_codepoints() -> set[int]:
    return {
        codepoint
        for start, end in LATIN_RANGES
        for codepoint in range(start, end + 1)
    }


def verify_toolchain() -> None:
    for distribution, expected in PINNED_TOOLCHAIN:
        try:
            actual = version(distribution)
        except PackageNotFoundError:
            raise RuntimeError(
                "Font build dependencies are missing; install requirements-fonts.txt"
            ) from None
        if actual != expected:
            raise RuntimeError(
                f"{distribution} must be {expected}; install requirements-fonts.txt"
            )


def verify_source(path: Path) -> None:
    try:
        payload = path.read_bytes()
    except OSError:
        raise RuntimeError("Wanted Sans input is missing or unreadable") from None

    actual = hashlib.sha256(payload).hexdigest()
    if actual != UPSTREAM_SHA256:
        raise RuntimeError(
            "Wanted Sans input does not match the audited v1.0.3 WOFF2: "
            f"expected {UPSTREAM_SHA256}, got {actual}"
        )


def build_subset(source: Path, destination: Path, codepoints: set[int]) -> None:
    from fontTools import subset
    from fontTools.ttLib import TTFont

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.name_legacy = True
    options.name_languages = ["*"]
    options.notdef_glyph = True
    options.recommended_glyphs = True

    font = TTFont(source)
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    destination.parent.mkdir(parents=True, exist_ok=True)
    font.save(destination)


def run() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    verify_toolchain()
    verify_source(args.input)
    build_subset(
        args.input,
        args.output_dir / "wanted-sans-variable-ksx1001.woff2",
        ksx1001_hangul_codepoints(),
    )
    build_subset(
        args.input,
        args.output_dir / "wanted-sans-variable-latin.woff2",
        latin_codepoints(),
    )


def main() -> int:
    try:
        run()
    except RuntimeError as error:
        print(f"Wanted Sans subset failed: {error}", file=sys.stderr)
        return 1
    except Exception:
        print("Wanted Sans subset failed: unexpected build error", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
