from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
import hashlib
import json
import re
import tempfile
import unicodedata
from pathlib import Path
from urllib.request import Request, urlopen

DEFAULT_SOURCE_PAGE_URL = "https://gist.github.com/HDR/0659d1717bc61504bf83750628963f4f"
DEFAULT_SOURCE_URL = "https://gist.githubusercontent.com/HDR/0659d1717bc61504bf83750628963f4f/raw/Forza%20Horizon%206%20Car%20Ordinals.json"
DEFAULT_CATALOG_DIR = Path("data/local/vehicle-catalog")
CATALOG_SCHEMA_VERSION = "goliath-fh6-vehicle-catalog-v1"
PROVENANCE_SCHEMA_VERSION = "goliath-fh6-vehicle-catalog-provenance-v1"
MAX_SOURCE_BYTES = 5_000_000
BIDI_FORMAT_CATEGORIES = {"Cf"}
WINDOWS_INVALID = '<>:"/\\|?*'


@dataclass(frozen=True)
class VehicleCatalogEntry:
    display_name: str
    filename_slug: str
    year: int | None = None


@dataclass(frozen=True)
class CatalogImportReport:
    source_type: str
    source_page_url: str
    source_location: str
    source_sha256: str
    source_entry_count: int
    accepted_entry_count: int
    rejected_entry_count: int
    duplicate_ordinal_conflict_count: int
    override_count: int
    normalized_catalog_path: str
    provenance_path: str
    source_snapshot_path: str
    duplicate_conflicts: list[dict[str, object]]


def safe_slug(display_name: str, *, fallback: str = "unknown-vehicle", max_length: int = 80) -> str:
    cleaned = sanitize_display_name(display_name, reject_controls=False)
    normalized = unicodedata.normalize("NFKD", cleaned)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    chars: list[str] = []
    for char in ascii_text.lower():
        if char.isalnum():
            chars.append(char)
        elif char.isspace() or char in "-_+.()[]{}'&":
            chars.append("-")
        elif char in WINDOWS_INVALID or ord(char) < 32:
            continue
        else:
            chars.append("-")
    slug = re.sub(r"-+", "-", "".join(chars)).strip("-._ ")
    if len(slug) > max_length:
        slug = slug[:max_length].rstrip("-")
    return slug or fallback


def sanitize_display_name(value: str, *, reject_controls: bool = True) -> str:
    if not isinstance(value, str):
        raise ValueError("display name must be a string")
    normalized = unicodedata.normalize("NFKC", value).strip()
    if not normalized:
        raise ValueError("display name must not be empty")
    sanitized_chars: list[str] = []
    for char in normalized:
        category = unicodedata.category(char)
        if category in BIDI_FORMAT_CATEGORIES:
            continue
        if category.startswith("C") and char not in "\t\n\r":
            if reject_controls:
                raise ValueError("display name contains control characters")
            continue
        sanitized_chars.append(char)
    sanitized = "".join(sanitized_chars).strip()
    if not sanitized:
        raise ValueError("display name became empty after sanitization")
    return sanitized


def parse_ordinal(raw: object) -> int:
    if isinstance(raw, bool):
        raise ValueError("ordinal must be an integer")
    if isinstance(raw, int):
        ordinal = raw
    elif isinstance(raw, str) and re.fullmatch(r"\d+", raw.strip()):
        ordinal = int(raw.strip())
    else:
        raise ValueError("ordinal must be an integer or integer-like string")
    if ordinal <= 0:
        raise ValueError("ordinal must be positive")
    return ordinal


def parse_year(display_name: str) -> int | None:
    match = re.match(r"^(\d{4})\b", display_name)
    if not match:
        return None
    year = int(match.group(1))
    return year if 1900 <= year <= 2100 else None


def normalize_source_catalog(source: dict[str, object]) -> tuple[dict[str, VehicleCatalogEntry], list[dict[str, object]], int]:
    accepted: dict[str, VehicleCatalogEntry] = {}
    duplicate_conflicts: list[dict[str, object]] = []
    rejected_count = 0
    for raw_name, raw_ordinal in source.items():
        try:
            display_name = sanitize_display_name(raw_name)
            if display_name.upper().startswith("NUL_CAR_"):
                raise ValueError("null placeholder vehicle")
            ordinal = parse_ordinal(raw_ordinal)
            key = str(ordinal)
            entry = VehicleCatalogEntry(
                display_name=display_name,
                filename_slug=safe_slug(display_name, fallback=f"car-{ordinal}"),
                year=parse_year(display_name),
            )
        except ValueError:
            rejected_count += 1
            continue
        existing = accepted.get(key)
        if existing and existing.display_name != entry.display_name:
            duplicate_conflicts.append(
                {
                    "ordinal": ordinal,
                    "existing_display_name": existing.display_name,
                    "conflicting_display_name": entry.display_name,
                }
            )
            rejected_count += 1
            continue
        accepted[key] = entry
    return accepted, duplicate_conflicts, rejected_count


def load_overrides(path: Path) -> dict[str, VehicleCatalogEntry]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(raw, dict):
        raise ValueError(f"vehicle overrides {path} must contain an object")
    overrides: dict[str, VehicleCatalogEntry] = {}
    for raw_ordinal, raw_payload in raw.items():
        ordinal = parse_ordinal(raw_ordinal)
        if not isinstance(raw_payload, dict):
            raise ValueError(f"override for {raw_ordinal} must contain an object")
        display_name = sanitize_display_name(str(raw_payload.get("display_name", "")))
        overrides[str(ordinal)] = VehicleCatalogEntry(
            display_name=display_name,
            filename_slug=safe_slug(display_name, fallback=f"car-{ordinal}"),
            year=parse_year(display_name),
        )
    return overrides


def import_vehicle_catalog(
    *,
    source_url: str = DEFAULT_SOURCE_URL,
    source_file: Path | None = None,
    catalog_dir: Path = DEFAULT_CATALOG_DIR,
    overrides_file: Path | None = None,
    timeout_s: float = 20.0,
    max_bytes: int = MAX_SOURCE_BYTES,
) -> CatalogImportReport:
    catalog_dir = Path(catalog_dir)
    source_dir = catalog_dir / "source"
    normalized_dir = catalog_dir / "normalized"
    overrides_path = Path(overrides_file) if overrides_file else catalog_dir / "vehicle-overrides.json"
    source_dir.mkdir(parents=True, exist_ok=True)
    normalized_dir.mkdir(parents=True, exist_ok=True)

    if source_file is not None:
        raw_bytes = Path(source_file).read_bytes()
        source_location = str(source_file)
    else:
        request = Request(source_url, headers={"User-Agent": "fh6-goliath-coach-catalog-import"})
        with urlopen(request, timeout=timeout_s) as response:  # nosec - user-controlled CLI utility, JSON only.
            raw_bytes = response.read(max_bytes + 1)
        source_location = source_url
    if len(raw_bytes) > max_bytes:
        raise ValueError(f"vehicle catalog source exceeds {max_bytes} bytes")
    source_sha256 = hashlib.sha256(raw_bytes).hexdigest()
    source_text = raw_bytes.decode("utf-8-sig")
    source_json = json.loads(source_text)
    if not isinstance(source_json, dict):
        raise ValueError("vehicle catalog source must contain a top-level object")

    vehicles, duplicate_conflicts, rejected_count = normalize_source_catalog(source_json)
    overrides = load_overrides(overrides_path)
    vehicles.update(overrides)

    normalized_payload = {
        "schema_version": CATALOG_SCHEMA_VERSION,
        "vehicles": {
            ordinal: _entry_payload(entry)
            for ordinal, entry in sorted(vehicles.items(), key=lambda item: int(item[0]))
        },
    }
    provenance_payload = {
        "schema_version": PROVENANCE_SCHEMA_VERSION,
        "source_type": "community_catalog",
        "source_page_url": DEFAULT_SOURCE_PAGE_URL,
        "source_location": source_location,
        "imported_at": datetime.now(UTC).isoformat(),
        "source_sha256": source_sha256,
        "source_entry_count": len(source_json),
        "accepted_entry_count": len(vehicles),
        "rejected_entry_count": rejected_count,
        "duplicate_ordinal_conflict_count": len(duplicate_conflicts),
        "override_count": len(overrides),
        "duplicate_conflicts": duplicate_conflicts,
    }

    source_snapshot_path = source_dir / "fh6-car-ordinals.source.json"
    catalog_path = normalized_dir / "fh6-vehicle-catalog.json"
    provenance_path = catalog_dir / "catalog-provenance.json"
    _atomic_write_bytes(source_snapshot_path, raw_bytes)
    _atomic_write_json(catalog_path, normalized_payload)
    _atomic_write_json(provenance_path, provenance_payload)

    return CatalogImportReport(
        source_type="community_catalog",
        source_page_url=DEFAULT_SOURCE_PAGE_URL,
        source_location=source_location,
        source_sha256=source_sha256,
        source_entry_count=len(source_json),
        accepted_entry_count=len(vehicles),
        rejected_entry_count=rejected_count,
        duplicate_ordinal_conflict_count=len(duplicate_conflicts),
        override_count=len(overrides),
        normalized_catalog_path=str(catalog_path),
        provenance_path=str(provenance_path),
        source_snapshot_path=str(source_snapshot_path),
        duplicate_conflicts=duplicate_conflicts,
    )


def load_normalized_catalog(catalog_dir: Path = DEFAULT_CATALOG_DIR) -> tuple[dict[str, VehicleCatalogEntry], dict[str, object] | None]:
    catalog_path = Path(catalog_dir) / "normalized" / "fh6-vehicle-catalog.json"
    provenance_path = Path(catalog_dir) / "catalog-provenance.json"
    if not catalog_path.exists():
        return {}, None
    payload = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict) or payload.get("schema_version") != CATALOG_SCHEMA_VERSION:
        raise ValueError(f"vehicle catalog {catalog_path} has an unsupported schema")
    vehicles_raw = payload.get("vehicles")
    if not isinstance(vehicles_raw, dict):
        raise ValueError(f"vehicle catalog {catalog_path} is missing vehicles")
    vehicles: dict[str, VehicleCatalogEntry] = {}
    for raw_ordinal, raw_entry in vehicles_raw.items():
        ordinal = str(parse_ordinal(raw_ordinal))
        if not isinstance(raw_entry, dict):
            raise ValueError(f"vehicle catalog entry {raw_ordinal} must be an object")
        display_name = sanitize_display_name(str(raw_entry.get("display_name", "")))
        filename_slug = safe_slug(str(raw_entry.get("filename_slug", "")), fallback=f"car-{ordinal}")
        year_raw = raw_entry.get("year")
        year = int(year_raw) if isinstance(year_raw, int) else parse_year(display_name)
        vehicles[ordinal] = VehicleCatalogEntry(display_name, filename_slug, year)
    provenance = None
    if provenance_path.exists():
        provenance_raw = json.loads(provenance_path.read_text(encoding="utf-8-sig"))
        provenance = provenance_raw if isinstance(provenance_raw, dict) else None
    return vehicles, provenance


def _entry_payload(entry: VehicleCatalogEntry) -> dict[str, object]:
    payload: dict[str, object] = {
        "display_name": entry.display_name,
        "filename_slug": entry.filename_slug,
    }
    if entry.year is not None:
        payload["year"] = entry.year
    return payload


def _atomic_write_json(path: Path, payload: object) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    _atomic_write_bytes(path, text.encode("utf-8"))


def _atomic_write_bytes(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, dir=path.parent) as temp_file:
        temp_file.write(payload)
        temp_path = Path(temp_file.name)
    temp_path.replace(path)


def report_as_dict(report: CatalogImportReport) -> dict[str, object]:
    return asdict(report)