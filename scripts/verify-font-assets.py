"""Verify the checked-in font assets without exposing machine-local paths.

The audit covers immutable file digests plus semantic metadata that browsers
rely on: family names, WOFF2 containers, weight metadata, and Unicode cmaps.
Install the exact toolchain from ``requirements-fonts.txt`` before running it.
"""

from __future__ import annotations

import hashlib
import sys
from dataclasses import dataclass
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Literal


PINNED_TOOLCHAIN = (
    ("fonttools", "4.63.0"),
    ("brotli", "1.2.0"),
)


class FontVerificationError(RuntimeError):
    """A stable, path-free font verification failure."""


@dataclass(frozen=True)
class FontContract:
    label: str
    relative_path: str
    sha256: str
    family: str
    cmap_kind: Literal["ksx1001", "latin", "hangul", "mono"]
    weight_axis: tuple[float, float, float] | None = None
    static_weight: int | None = None


FONT_CONTRACTS = (
    FontContract(
        label="Wanted Sans KS X 1001",
        relative_path="public/fonts/wanted-sans/wanted-sans-variable-ksx1001.woff2",
        sha256="e9d3c602974d5fba2aa4369349aa1e832455c55bfc793a205a5ca21a0ec054f8",
        family="Wanted Sans Variable",
        cmap_kind="ksx1001",
        weight_axis=(400.0, 400.0, 1000.0),
    ),
    FontContract(
        label="Wanted Sans Latin",
        relative_path="public/fonts/wanted-sans/wanted-sans-variable-latin.woff2",
        sha256="a785fbc798025b7e672b36dd1df2264292b3117d9580d6f3ddf8c6df3ea0ca13",
        family="Wanted Sans Variable",
        cmap_kind="latin",
        weight_axis=(400.0, 400.0, 1000.0),
    ),
    FontContract(
        label="Pretendard",
        relative_path="public/fonts/pretendard/pretendard-variable.woff2",
        sha256="9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4",
        family="Pretendard Variable",
        cmap_kind="hangul",
        weight_axis=(45.0, 400.0, 930.0),
    ),
    FontContract(
        label="JetBrains Mono Regular",
        relative_path="public/fonts/jetbrains-mono/jetbrains-mono-regular.woff2",
        sha256="a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2",
        family="JetBrains Mono",
        cmap_kind="mono",
        static_weight=400,
    ),
    FontContract(
        label="JetBrains Mono Bold",
        relative_path="public/fonts/jetbrains-mono/jetbrains-mono-bold.woff2",
        sha256="c503cc5ec5f8b2c7666b7ecda1adf44bd45f2e6579b2eba0fc292150416588a2",
        family="JetBrains Mono",
        cmap_kind="mono",
        static_weight=700,
    ),
)


def verify_toolchain() -> None:
    for distribution, expected in PINNED_TOOLCHAIN:
        try:
            actual = version(distribution)
        except PackageNotFoundError:
            raise FontVerificationError(
                "font verification dependencies are missing; "
                "install requirements-fonts.txt"
            ) from None
        if actual != expected:
            raise FontVerificationError(
                f"{distribution} must be {expected}; install requirements-fonts.txt"
            )


def ksx1001_hangul_codepoints() -> set[int]:
    return {
        ord(bytes((lead, trail)).decode("euc_kr"))
        for lead in range(0xB0, 0xC9)
        for trail in range(0xA1, 0xFF)
    }


def family_names(font: object, name_id: int) -> set[str]:
    name_table = font["name"]  # type: ignore[index]
    return {record.toUnicode() for record in name_table.names if record.nameID == name_id}


def unicode_cmap(font: object) -> set[int]:
    cmap_table = font["cmap"]  # type: ignore[index]
    return set().union(
        *(set(table.cmap) for table in cmap_table.tables if table.isUnicode())
    )


def verify_cmap(contract: FontContract, codepoints: set[int]) -> None:
    ascii_printable = set(range(0x20, 0x7F))
    modern_hangul = set(range(0xAC00, 0xD7A4))

    if contract.cmap_kind == "ksx1001":
        expected = ksx1001_hangul_codepoints()
        if len(expected) != 2_350 or codepoints != expected:
            raise FontVerificationError(
                f"{contract.label}: cmap is not the 2,350-glyph KS X 1001 set"
            )
        return

    if contract.cmap_kind == "latin":
        if not ascii_printable.issubset(codepoints):
            raise FontVerificationError(f"{contract.label}: cmap is missing printable ASCII")
        if codepoints & modern_hangul:
            raise FontVerificationError(f"{contract.label}: cmap unexpectedly contains Hangul")
        if len(codepoints) != 520:
            raise FontVerificationError(f"{contract.label}: cmap inventory changed")
        return

    if contract.cmap_kind == "hangul":
        if not ascii_printable.issubset(codepoints):
            raise FontVerificationError(f"{contract.label}: cmap is missing printable ASCII")
        if not modern_hangul.issubset(codepoints):
            raise FontVerificationError(
                f"{contract.label}: cmap does not cover all modern Hangul syllables"
            )
        return

    if not ascii_printable.issubset(codepoints):
        raise FontVerificationError(f"{contract.label}: cmap is missing printable ASCII")


def verify_weight(contract: FontContract, font: object) -> None:
    if contract.weight_axis is not None:
        if "fvar" not in font:  # type: ignore[operator]
            raise FontVerificationError(f"{contract.label}: wght axis is missing")
        axes = {
            axis.axisTag: (axis.minValue, axis.defaultValue, axis.maxValue)
            for axis in font["fvar"].axes  # type: ignore[index]
        }
        if set(axes) != {"wght"} or axes["wght"] != contract.weight_axis:
            raise FontVerificationError(f"{contract.label}: wght axis range changed")
        return

    if "fvar" in font and any(  # type: ignore[operator]
        axis.axisTag == "wght" for axis in font["fvar"].axes  # type: ignore[index]
    ):
        raise FontVerificationError(f"{contract.label}: expected a static weight")
    actual_weight = font["OS/2"].usWeightClass  # type: ignore[index]
    if actual_weight != contract.static_weight:
        raise FontVerificationError(f"{contract.label}: static weight changed")


def verify_asset(root: Path, contract: FontContract, ttfont_type: type) -> None:
    asset_path = root / contract.relative_path
    try:
        payload = asset_path.read_bytes()
    except OSError:
        raise FontVerificationError(f"{contract.label}: asset is missing or unreadable") from None

    if hashlib.sha256(payload).hexdigest() != contract.sha256:
        raise FontVerificationError(f"{contract.label}: SHA-256 mismatch")
    if payload[:4] != b"wOF2":
        raise FontVerificationError(f"{contract.label}: container is not WOFF2")

    try:
        font = ttfont_type(asset_path, lazy=False)
    except Exception:
        raise FontVerificationError(f"{contract.label}: metadata is unreadable") from None

    try:
        if font.flavor != "woff2":
            raise FontVerificationError(f"{contract.label}: decoded format is not WOFF2")

        legacy_families = family_names(font, 1)
        typographic_families = family_names(font, 16)
        if contract.family not in legacy_families:
            raise FontVerificationError(f"{contract.label}: family name changed")
        if typographic_families and contract.family not in typographic_families:
            raise FontVerificationError(f"{contract.label}: typographic family name changed")

        verify_weight(contract, font)
        verify_cmap(contract, unicode_cmap(font))
    finally:
        font.close()


def run() -> None:
    verify_toolchain()
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        raise FontVerificationError(
            "font verification dependencies are missing; install requirements-fonts.txt"
        ) from None

    root = Path(__file__).resolve().parent.parent
    for contract in FONT_CONTRACTS:
        verify_asset(root, contract, TTFont)


def main() -> int:
    try:
        run()
    except FontVerificationError as error:
        print(f"Font verification failed: {error}", file=sys.stderr)
        return 1
    except Exception:
        print("Font verification failed: unexpected verifier error", file=sys.stderr)
        return 1

    print(f"Verified {len(FONT_CONTRACTS)} font assets.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
