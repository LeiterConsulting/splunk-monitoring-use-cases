#!/usr/bin/env python3
"""Build deterministic requirement profiles for discovery and mapping.

The discovery feature needs a runtime contract that describes what each use
case expects from a Splunk environment before any local scanner or mapping
engine runs. Canonical per-UC sidecars under ``content/cat-*/UC-*.json`` are
the preferred source, but the live catalog still contains a small tail of
legacy markdown-only records that exist only inside ``catalog.json``.

This module normalizes both sources into one deterministic payload so the
generator can ship a complete runtime requirement index without introducing a
new authoring surface or hand-maintained app files.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Sequence, Tuple


PROFILE_SCHEMA_VERSION = "1.0.0"
REQUIREMENTS_ENDPOINT = "/api/v1/discovery/requirements.json"

_SPLIT_RE = re.compile(r"[,;\n]+")
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_INDEX_RE = re.compile(r"\bindex\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|`([^`]+)`|([^\s|]+))")
_SOURCETYPE_RE = re.compile(r"\bsourcetype\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|`([^`]+)`|([^\s|]+))")
_DATAMODEL_RE = re.compile(r"\bdatamodel\s*=\s*(?:\"([^\"]+)\"|'([^']+)'|`([^`]+)`|([^\s|]+))", re.IGNORECASE)
_UC_FULL_RE = re.compile(r"^UC-(\d+)\.(\d+)\.(\d+)$")
_UC_BARE_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    text = _MARKDOWN_LINK_RE.sub(r"\1", text)
    text = text.replace("`", "")
    return re.sub(r"\s+", " ", text).strip()


def _as_text_list(value: Any) -> List[str]:
    if isinstance(value, list):
        items = [_clean_text(item) for item in value]
    elif value is None:
        items = []
    else:
        cleaned = _clean_text(value)
        items = [_clean_text(part) for part in _SPLIT_RE.split(cleaned)] if cleaned else []
    deduped = sorted({item for item in items if item})
    return [item for item in deduped if item != "N/A"]


def _normalize_uc_id(value: str) -> str:
    value = str(value).strip()
    if _UC_FULL_RE.match(value):
        return value
    match = _UC_BARE_RE.match(value)
    if not match:
        raise ValueError(f"Invalid use case id: {value}")
    return f"UC-{value}"


def _uc_sort_key(full_uc_id: str) -> Tuple[int, int, int]:
    match = _UC_FULL_RE.match(full_uc_id)
    if not match:
        return (10**6, 10**6, 10**6)
    return tuple(int(part) for part in match.groups())


def _extract_tokens(pattern: re.Pattern[str], texts: Iterable[str]) -> List[str]:
    values = set()
    for text in texts:
        if not text:
            continue
        for match in pattern.finditer(text):
            token = next((group for group in match.groups() if group), "")
            token = token.strip().strip('"\'`')
            if token:
                values.add(token)
    return sorted(values)


def _extract_search_hints(*texts: str, cim_models: Sequence[str] | None = None) -> Dict[str, Any]:
    indexes = _extract_tokens(_INDEX_RE, texts)
    sourcetypes = _extract_tokens(_SOURCETYPE_RE, texts)
    datamodels = set(_extract_tokens(_DATAMODEL_RE, texts))
    for model in cim_models or []:
        cleaned = _clean_text(model)
        if cleaned and cleaned != "N/A":
            datamodels.add(cleaned)
    return {
        "indexes": indexes,
        "sourcetypes": sourcetypes,
        "datamodels": sorted(datamodels),
        "requires_cim": bool(datamodels),
    }


def load_sidecar_uc_map(repo_root: Path) -> Dict[str, Dict[str, Any]]:
    content_root = repo_root / "content"
    out: Dict[str, Dict[str, Any]] = {}
    if not content_root.exists():
        return out
    for path in sorted(content_root.glob("cat-*/UC-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        full_uc_id = _normalize_uc_id(str(data["id"]))
        out[full_uc_id] = {
            "path": str(path.relative_to(repo_root)),
            "data": data,
        }
    return out


def load_catalog_compact_uc_map(repo_root: Path) -> Dict[str, Dict[str, Any]]:
    catalog = json.loads((repo_root / "catalog.json").read_text(encoding="utf-8"))
    roadmap = catalog.get("implementationRoadmap") or {}
    wave_by_id: Dict[str, str] = {}
    for phase_map in roadmap.values():
        for wave_name in ("crawl", "walk", "run", "unassigned"):
            for full_uc_id in phase_map.get(wave_name) or []:
                wave_by_id[str(full_uc_id)] = wave_name

    out: Dict[str, Dict[str, Any]] = {}
    for category in catalog.get("DATA") or []:
        category_name = str(category.get("n") or "")
        category_id = int(category.get("i") or 0)
        for subcategory in category.get("s") or []:
            subcategory_id = str(subcategory.get("i") or "")
            subcategory_name = str(subcategory.get("n") or "")
            for uc in subcategory.get("u") or []:
                full_uc_id = _normalize_uc_id(str(uc.get("i") or ""))
                out[full_uc_id] = {
                    "compact": uc,
                    "category_id": category_id,
                    "category_name": category_name,
                    "subcategory_id": subcategory_id,
                    "subcategory_name": subcategory_name,
                    "wave": wave_by_id.get(full_uc_id, ""),
                }
    return out


def _compact_title(compact: Mapping[str, Any]) -> str:
    return _clean_text(compact.get("n"))


def _simplify_compliance(entries: Any) -> List[Dict[str, str]]:
    simplified: List[Dict[str, str]] = []
    for entry in entries or []:
        if not isinstance(entry, Mapping):
            continue
        simplified.append(
            {
                "regulation": _clean_text(entry.get("regulation")),
                "version": _clean_text(entry.get("version")),
                "clause": _clean_text(entry.get("clause")),
                "mode": _clean_text(entry.get("mode")),
                "assurance": _clean_text(entry.get("assurance")),
            }
        )
    simplified.sort(key=lambda item: (item["regulation"], item["version"], item["clause"]))
    return simplified


def _build_profile(
    full_uc_id: str,
    generated_at: str,
    compact_context: Mapping[str, Any],
    sidecar_entry: Mapping[str, Any] | None,
) -> Dict[str, Any]:
    compact = compact_context.get("compact") or {}
    sidecar = sidecar_entry.get("data") if sidecar_entry else None
    sidecar_path = sidecar_entry.get("path") if sidecar_entry else None

    title = _clean_text((sidecar or {}).get("title") or _compact_title(compact))
    app_text = _clean_text((sidecar or {}).get("app") or compact.get("t"))
    data_sources_text = _clean_text((sidecar or {}).get("dataSources") or compact.get("d"))
    primary_spl = str((sidecar or {}).get("spl") or compact.get("q") or "")
    cim_spl = str((sidecar or {}).get("cimSpl") or "")
    cim_models = _as_text_list((sidecar or {}).get("cimModels") or compact.get("a"))
    monitoring_types = _as_text_list((sidecar or {}).get("monitoringType") or compact.get("mtype"))
    required_fields = _as_text_list((sidecar or {}).get("requiredFields") or compact.get("reqf"))
    equipment = _as_text_list((sidecar or {}).get("equipment") or compact.get("e"))
    equipment_models = _as_text_list((sidecar or {}).get("equipmentModels") or compact.get("em"))
    mitre_attack = _as_text_list((sidecar or {}).get("mitreAttack") or compact.get("mitre"))
    criticality = _clean_text((sidecar or {}).get("criticality") or compact.get("c"))
    difficulty = _clean_text((sidecar or {}).get("difficulty") or compact.get("f"))
    splunk_pillar = _clean_text((sidecar or {}).get("splunkPillar") or compact.get("pillar"))
    wave = _clean_text((sidecar or {}).get("wave") or compact_context.get("wave"))
    compliance = _simplify_compliance((sidecar or {}).get("compliance"))

    search_hints = _extract_search_hints(primary_spl, cim_spl, data_sources_text, cim_models=cim_models)
    source_kind = "sidecar" if sidecar is not None else "catalog_compact"
    source_refs = [str(sidecar_path)] if sidecar_path else [f"catalog.json#{full_uc_id}"]

    return {
        "use_case_id": full_uc_id,
        "schema_version": PROFILE_SCHEMA_VERSION,
        "title": title,
        "category": _clean_text(compact_context.get("category_name")),
        "generated_at": generated_at,
        "requirements": {
            "category_id": compact_context.get("category_id"),
            "subcategory_id": _clean_text(compact_context.get("subcategory_id")),
            "subcategory_name": _clean_text(compact_context.get("subcategory_name")),
            "criticality": criticality,
            "difficulty": difficulty,
            "wave": wave,
            "monitoring_types": monitoring_types,
            "splunk_pillar": splunk_pillar,
            "app_text": app_text,
            "app_candidates": _as_text_list(app_text),
            "data_source_text": data_sources_text,
            "required_fields": required_fields,
            "cim_models": cim_models,
            "mitre_attack": mitre_attack,
            "equipment": equipment,
            "equipment_models": equipment_models,
            "compliance": compliance,
            "searches": {
                "primary_spl": primary_spl,
                "cim_spl": cim_spl,
            },
            "status": _clean_text((sidecar or {}).get("status") or compact.get("status")),
        },
        "normalization_hints": {
            **search_hints,
            "source_kind": source_kind,
            "catalog_fallback": sidecar is None,
            "wave_source": "sidecar" if (sidecar or {}).get("wave") else ("catalog_roadmap" if compact_context.get("wave") else ""),
            "has_compliance": bool(compliance),
        },
        "source_refs": source_refs,
    }


def build_discovery_requirement_payload(
    repo_root: Path,
    generated_at: str,
    catalog_version: str,
) -> Dict[str, Any]:
    compact_map = load_catalog_compact_uc_map(repo_root)
    sidecar_map = load_sidecar_uc_map(repo_root)
    full_uc_ids = sorted(set(compact_map) | set(sidecar_map), key=_uc_sort_key)

    profiles: List[Dict[str, Any]] = []
    missing_sidecar_use_cases: List[str] = []
    canonical_sidecar_count = 0
    for full_uc_id in full_uc_ids:
        compact_context = compact_map.get(full_uc_id)
        if compact_context is None:
            # The runtime discovery contract should stay aligned with the live
            # catalog tree. Sidecar-only records are unexpected, so skip them
            # rather than inventing missing category context.
            continue
        sidecar_entry = sidecar_map.get(full_uc_id)
        if sidecar_entry is None:
            missing_sidecar_use_cases.append(full_uc_id)
        else:
            canonical_sidecar_count += 1
        profiles.append(_build_profile(full_uc_id, generated_at, compact_context, sidecar_entry))

    return {
        "schemaVersion": PROFILE_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "catalogVersion": catalog_version,
        "profileCount": len(profiles),
        "canonicalSidecarCount": canonical_sidecar_count,
        "catalogFallbackCount": len(missing_sidecar_use_cases),
        "missingSidecarUseCases": missing_sidecar_use_cases,
        "profiles": profiles,
    }


__all__ = [
    "PROFILE_SCHEMA_VERSION",
    "REQUIREMENTS_ENDPOINT",
    "build_discovery_requirement_payload",
    "load_catalog_compact_uc_map",
    "load_sidecar_uc_map",
]