#!/usr/bin/env python3
"""Generate the monitoring_use_cases Splunk app from the compiled catalog."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import textwrap
from dataclasses import dataclass
from typing import Dict, Iterable, List

from discovery_requirements import (
    REQUIREMENTS_ENDPOINT,
    build_discovery_requirement_payload,
)


PROJECT_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = PROJECT_ROOT / "splunk-apps"
BUILD_SCRIPT = PROJECT_ROOT / "tools" / "build" / "build.py"
API_SURFACE_SCRIPT = PROJECT_ROOT / "scripts" / "generate_api_surface.py"
ROOT_LICENSE = PROJECT_ROOT / "LICENSE"
CUSTOM_TEXT_FILE = PROJECT_ROOT / "custom-text.js"

APP_ID = "monitoring_use_cases"
APP_TITLE = "Monitoring Use Cases Catalog"
APP_LABEL = "Monitoring Use Cases"
APP_STATIC_BASE = f"/static/app/{APP_ID}"
SITE_URL = f"https://example.invalid{APP_STATIC_BASE}"

EXCLUDED_TOP_LEVEL = {
    "integrity.json",
    "splunk-apps",
    "ta",
    "templates",
    "samples",
    "schemas",
    "uc",
    "use-cases",
}

MACOS_METADATA_NAMES = {
    ".DS_Store",
}

MACOS_METADATA_PREFIXES = (
    "._",
)

STATIC_LINKS = (
    ("Scorecard", "scorecard", "scorecard.html", ""),
    ("Regulatory primer", "regulatory_primer", "regulatory-primer.html", ""),
    ("Clause navigator", "clause_navigator", "clause-navigator.html", ""),
    ("Compliance story", "compliance_story", "compliance-story.html", ""),
    ("API docs", "api_docs", "api-docs.html", ""),
    ("Data sizing tool", "data_sizing", "tools/data-sizing/index.html", ""),
)

HOST_SCRIPT_NAME = "monitoring_use_cases_host.js"
HOST_STYLESHEET_NAME = "monitoring_use_cases_host.css"

DISCOVERY_ENGINE_STATES = (
    "direct",
    "adjacent",
    "partial",
    "none",
)

DISCOVERY_EFFECTIVE_STATES = DISCOVERY_ENGINE_STATES + (
    "admin_asserted",
    "admin_rejected",
)

DISCOVERY_OVERRIDE_TYPES = (
    "assert_direct",
    "assert_adjacent",
    "assert_partial",
    "reject",
    "note_only",
)

DISCOVERY_SCAN_RUN_ID = "inventory_snapshot_latest"

DISCOVERY_SCAN_MODES = (
    {
        "id": "quick",
        "label": "Quick scan",
        "description": (
            "Metadata inventory only for indexes, sourcetypes, sources, and hosts."
        ),
        "stages": [
            "inventory_indexes",
            "inventory_sourcetypes",
            "inventory_sources",
            "inventory_hosts",
            "inventory_summary",
        ],
    },
    {
        "id": "standard",
        "label": "Standard scan",
        "description": (
            "Metadata inventory plus field prevalence and CIM clues."
        ),
        "stages": [
            "inventory_indexes",
            "inventory_sourcetypes",
            "inventory_sources",
            "inventory_hosts",
            "inventory_cim",
            "inventory_fields",
            "inventory_telemetry",
            "inventory_summary",
        ],
    },
    {
        "id": "deep",
        "label": "Deep scan",
        "description": (
            "Reserved for expanded sampling after the bounded inventory stages are stable."
        ),
        "stages": [
            "inventory_indexes",
            "inventory_sourcetypes",
            "inventory_sources",
            "inventory_hosts",
            "inventory_cim",
            "inventory_fields",
            "inventory_telemetry",
            "inventory_summary",
        ],
    },
)

DISCOVERY_INVENTORY_CAPS = {
    "indexes": 512,
    "sourcetypes": 4000,
    "sources": 5000,
    "hosts": 5000,
    "data_models": 256,
    "field_sample_sourcetypes": 24,
    "field_sample_events": 200,
    "field_sample_fields": 20,
}

DISCOVERY_COLLECTIONS = (
    {
        "name": "muc_requirement_profiles",
        "schema": "requirementProfile",
        "purpose": "Normalized runtime requirements for each use case.",
        "primary_key": "use_case_id",
        "field_types": {
            "use_case_id": "string",
            "schema_version": "string",
            "title": "string",
            "category": "string",
            "generated_at": "string",
            "requirement_summary": "string",
        },
        "accelerated_fields": {
            "use_case_id": {"use_case_id": 1},
            "category": {"category": 1},
        },
    },
    {
        "name": "muc_discovered_datasets",
        "schema": "discoveredDataset",
        "purpose": "Normalized datasets observed in the local Splunk environment.",
        "primary_key": "dataset_id",
        "field_types": {
            "dataset_id": "string",
            "scan_run_id": "string",
            "dataset_key": "string",
            "display_name": "string",
            "origin": "string",
            "snapshot_source": "string",
            "last_seen": "string",
            "confidence": "number",
        },
        "accelerated_fields": {
            "scan_run_id": {"scan_run_id": 1},
            "dataset_key": {"dataset_key": 1},
        },
    },
    {
        "name": "muc_use_case_mappings",
        "schema": "useCaseMapping",
        "purpose": "Engine and effective mapping state for each use case.",
        "primary_key": "use_case_id",
        "field_types": {
            "use_case_id": "string",
            "scan_run_id": "string",
            "engine_state": "string",
            "effective_state": "string",
            "updated_at": "string",
            "precedence_reason": "string",
        },
        "accelerated_fields": {
            "scan_run_id": {"scan_run_id": 1},
            "effective_state": {"effective_state": 1},
        },
    },
    {
        "name": "muc_mapping_overrides",
        "schema": "mappingOverride",
        "purpose": "Admin-authored overrides that persist across reruns.",
        "primary_key": "override_id",
        "field_types": {
            "override_id": "string",
            "use_case_id": "string",
            "dataset_id": "string",
            "override_type": "string",
            "created_by": "string",
            "created_at": "string",
            "active": "string",
        },
        "accelerated_fields": {
            "use_case_id": {"use_case_id": 1},
            "active": {"active": 1},
        },
    },
    {
        "name": "muc_scan_runs",
        "schema": "scanRun",
        "purpose": "Lifecycle and summary telemetry for discovery scans.",
        "primary_key": "scan_run_id",
        "field_types": {
            "scan_run_id": "string",
            "status": "string",
            "mode": "string",
            "started_at": "string",
            "completed_at": "string",
            "failed_stage": "string",
            "summary_json": "string",
            "datasets_discovered": "number",
        },
        "accelerated_fields": {
            "status": {"status": 1},
            "started_at": {"started_at": 1},
        },
    },
    {
        "name": "muc_scan_logs",
        "schema": "scanLog",
        "purpose": "Stage-by-stage logs for each discovery scan.",
        "primary_key": "log_id",
        "field_types": {
            "log_id": "string",
            "scan_run_id": "string",
            "stage": "string",
            "level": "string",
            "logged_at": "string",
            "message": "string",
            "record_count": "number",
            "details_json": "string",
        },
        "accelerated_fields": {
            "scan_run_id": {"scan_run_id": 1},
            "stage": {"stage": 1},
        },
    },
    {
        "name": "muc_adjacency_registry",
        "schema": "adjacencyRegistry",
        "purpose": "Deterministic adjacency hints and evidence weights.",
        "primary_key": "adjacency_id",
        "field_types": {
            "adjacency_id": "string",
            "source_key": "string",
            "target_key": "string",
            "relation_type": "string",
            "weight": "number",
            "updated_at": "string",
        },
        "accelerated_fields": {
            "source_key": {"source_key": 1},
            "target_key": {"target_key": 1},
        },
    },
)

I18N_REGISTER_SHIM = textwrap.dedent(
    """\
    <script>
    window.i18n_register = window.i18n_register || function () {};
    </script>
    """
)


@dataclass(frozen=True)
class BuildMetadata:
    version: str
    generated_at: str
    git_sha: str
    use_case_count: int


def _normalize_semver(value: str) -> str:
    parts = value.split(".")
    if parts and all(part.isdigit() for part in parts):
        while len(parts) < 3:
            parts.append("0")
        return ".".join(parts[:3])
    return value


def _write_text(path: pathlib.Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _write_json(path: pathlib.Path, payload: object) -> None:
    _write_text(path, json.dumps(payload, indent=2, sort_keys=False) + "\n")


def _is_macos_metadata(path: pathlib.Path) -> bool:
    return path.name in MACOS_METADATA_NAMES or path.name.startswith(MACOS_METADATA_PREFIXES)


def _copy_path(src: pathlib.Path, dst: pathlib.Path) -> None:
    if _is_macos_metadata(src):
        return
    if src.is_dir():
        if dst.exists():
            if dst.is_dir():
                shutil.rmtree(dst)
            else:
                dst.unlink()
        shutil.copytree(
            src,
            dst,
            ignore=shutil.ignore_patterns(*MACOS_METADATA_NAMES, *MACOS_METADATA_PREFIXES),
        )
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)


def _inject_i18n_register_shim(html: str) -> str:
    if "window.i18n_register" in html:
        return html
    if "</head>" in html:
        return html.replace("</head>", f"{I18N_REGISTER_SHIM}</head>", 1)
    if "<script" in html:
        return html.replace("<script", f"{I18N_REGISTER_SHIM}<script", 1)
    return I18N_REGISTER_SHIM + html


def _patch_html_files_for_splunk(static_root: pathlib.Path) -> None:
    for html_path in static_root.rglob("*.html"):
        html = html_path.read_text(encoding="utf-8")
        patched = _inject_i18n_register_shim(html)
        if patched != html:
            html_path.write_text(patched, encoding="utf-8")


def _build_site(out_dir: pathlib.Path) -> BuildMetadata:
    env = os.environ.copy()
    env["SITE_URL"] = SITE_URL
    subprocess.run(
        [
            sys.executable,
            str(BUILD_SCRIPT),
            "--out",
            str(out_dir),
            "--reproducible",
        ],
        check=True,
        cwd=str(PROJECT_ROOT),
        env=env,
    )
    subprocess.run(
        [
            sys.executable,
            str(API_SURFACE_SCRIPT),
            "--out",
            str(out_dir / "api" / "v1"),
        ],
        check=True,
        cwd=str(PROJECT_ROOT),
        env=env,
    )

    build_info = json.loads((out_dir / "BUILD-INFO.json").read_text(encoding="utf-8"))
    version = _normalize_semver(str(build_info.get("catalogueVersion", "0.0.0")))
    generated_at = str(build_info.get("build", {}).get("timestamp", "1970-01-01T00:00:00Z"))
    git_sha = str(build_info.get("git", {}).get("sha", "unknown"))
    use_case_count = int(build_info.get("counts", {}).get("useCases", 0))
    return BuildMetadata(
        version=version,
        generated_at=generated_at,
        git_sha=git_sha,
        use_case_count=use_case_count,
    )


def _copy_site_subset(site_root: pathlib.Path, static_root: pathlib.Path) -> None:
    static_root.mkdir(parents=True, exist_ok=True)
    for child in sorted(site_root.iterdir(), key=lambda path: path.name):
        if child.name in EXCLUDED_TOP_LEVEL:
            continue
        _copy_path(child, static_root / child.name)

    api_root = site_root / "api"
    if api_root.exists():
        _copy_path(api_root, static_root / "api")

    if not CUSTOM_TEXT_FILE.exists():
        raise FileNotFoundError(f"Missing required custom text source: {CUSTOM_TEXT_FILE}")
    shutil.copy2(CUSTOM_TEXT_FILE, static_root / CUSTOM_TEXT_FILE.name)

    _patch_html_files_for_splunk(static_root)


def _app_manifest(meta: BuildMetadata) -> Dict[str, object]:
    description = (
        "Hosts the compiled Splunk Monitoring Use Cases catalog inside Splunk "
        "as a static app, including the overview dashboard, API-backed search, "
        "documentation, reports, and companion tooling."
    )
    return {
        "schemaVersion": "2.0.0",
        "info": {
            "id": {
                "group": None,
                "name": APP_ID,
                "version": meta.version,
            },
            "title": APP_TITLE,
            "author": [
                {
                    "company": None,
                    "email": None,
                    "name": "Splunk Monitoring Use Cases contributors",
                }
            ],
            "classification": {
                "categories": ["IT Operations", "Security"],
                "developmentStatus": "Production/Stable",
                "intendedAudience": "SecOps, IT Operations, Platform owners",
            },
            "commonInformationModels": {
                "Splunk_CIM": "5.3",
            },
            "description": description,
            "license": {
                "name": "MIT",
                "text": "LICENSE",
                "uri": "https://github.com/fenre/splunk-monitoring-use-cases/blob/main/LICENSE",
            },
            "privacyPolicy": {
                "name": None,
                "text": None,
                "uri": None,
            },
            "releaseDate": None,
            "releaseNotes": {
                "name": None,
                "text": "README.md",
                "uri": "https://github.com/fenre/splunk-monitoring-use-cases/blob/main/CHANGELOG.md",
            },
        },
        "dependencies": None,
        "incompatibleApps": {},
        "inputGroups": {},
        "platformRequirements": {
            "splunk": {
                "Enterprise": ">=9.2",
            }
        },
        "supportedDeployments": [
            "_standalone",
            "_distributed",
            "_search_head_clustering",
        ],
        "targetWorkloads": ["_search_heads"],
        "tasks": [],
    }


def _app_conf(meta: BuildMetadata) -> str:
    install_build = "".join(ch for ch in meta.generated_at if ch.isdigit()) or "1"

    return textwrap.dedent(
        f"""\
        # -----------------------------------------------------------------
        # GENERATED by scripts/generate_monitoring_use_cases_app.py — DO NOT EDIT.
        # Source of truth: scripts/generate_monitoring_use_cases_app.py.
        # Re-run `python3 scripts/generate_monitoring_use_cases_app.py` after edits.
        # -----------------------------------------------------------------

        [install]
        is_configured = 0
        state = enabled
        build = {install_build}

        [ui]
        is_visible = true
        label = {APP_LABEL}

        [launcher]
        author = Splunk Monitoring Use Cases contributors
        description = Hosts the compiled Monitoring Use Cases catalog inside Splunk as a static app.
        version = {meta.version}

        [package]
        id = {APP_ID}
        check_for_updates = false
        """
    )


def _collections_conf() -> str:
    blocks: List[str] = [
        textwrap.dedent(
            """\
            # -----------------------------------------------------------------
            # GENERATED by scripts/generate_monitoring_use_cases_app.py — DO NOT EDIT.
            # Source of truth: scripts/generate_monitoring_use_cases_app.py.
            # Re-run `python3 scripts/generate_monitoring_use_cases_app.py` after edits.
            # -----------------------------------------------------------------
            """
        ).rstrip()
    ]
    for collection in DISCOVERY_COLLECTIONS:
        block_lines = [f"[{collection['name']}]", "enforceTypes = false"]
        field_types = collection["field_types"]
        for field_name, field_type in field_types.items():
            block_lines.append(f"field.{field_name} = {field_type}")
        accelerated_fields = collection.get("accelerated_fields", {})
        for name, payload in accelerated_fields.items():
            block_lines.append(
                f"accelerated_fields.{name} = {json.dumps(payload, sort_keys=True)}"
            )
        blocks.append("\n".join(block_lines))
    return "\n\n".join(blocks) + "\n"


def _transforms_conf() -> str:
    blocks: List[str] = [
        textwrap.dedent(
            """\
            # -----------------------------------------------------------------
            # GENERATED by scripts/generate_monitoring_use_cases_app.py — DO NOT EDIT.
            # Source of truth: scripts/generate_monitoring_use_cases_app.py.
            # Re-run `python3 scripts/generate_monitoring_use_cases_app.py` after edits.
            # -----------------------------------------------------------------
            """
        ).rstrip()
    ]
    for collection in DISCOVERY_COLLECTIONS:
        field_names = ["_key", *collection["field_types"].keys()]
        block_lines = [
            f"[{collection['name']}]",
            "external_type = kvstore",
            f"collection = {collection['name']}",
            f"fields_list = {', '.join(dict.fromkeys(field_names))}",
        ]
        blocks.append("\n".join(block_lines))
    return "\n\n".join(blocks) + "\n"


def _discovery_savedsearches() -> List[Dict[str, str]]:
    def rewrite_latest_snapshot_slice(origin: str, current_slice_search: str) -> str:
        return textwrap.dedent(
            f"""\
            | inputlookup muc_discovered_datasets
            | search NOT (scan_run_id=\"{DISCOVERY_SCAN_RUN_ID}\" AND origin=\"{origin}\")
            | append [
            {textwrap.indent(current_slice_search.strip(), '    ')}
            ]
            | append [ | inputlookup muc_discovered_datasets | search scan_run_id=\"{DISCOVERY_SCAN_RUN_ID}\" origin=\"{origin}\" | eval _slice_source=\"prior\" ]
            | eval _slice_priority=case(_slice_source=\"current\", 2, _slice_source=\"prior\", 1, true(), 0), _preserve_scope=if(_slice_priority>0, coalesce(dataset_key, _key), _key)
            | sort 0 _preserve_scope - _slice_priority
            | dedup _preserve_scope
            | eval snapshot_source=_slice_source
            | fields - _slice_priority _preserve_scope _slice_source
            | outputlookup muc_discovered_datasets append=false
            """
        ).strip()

    return [
        {
            "name": "Monitoring Use Cases - Discovery Index Inventory",
            "stage": "inventory_indexes",
            "mode": "quick",
            "output_collection": "muc_discovered_datasets",
            "cron_schedule": "*/30 * * * *",
            "dispatch_earliest_time": "-1d@d",
            "dispatch_latest_time": "now",
            "description": (
                "Captures a bounded inventory of active indexes and rewrites only the "
                "metadata_index slice of muc_discovered_datasets."
            ),
            "search": rewrite_latest_snapshot_slice(
                "metadata_index",
                f"""\
                | eventcount summarize=false index=* | sort 0 - count | head {DISCOVERY_INVENTORY_CAPS['indexes']} | eval dataset_key="index::" . index, _key=dataset_key, dataset_id=md5(dataset_key), scan_run_id="{DISCOVERY_SCAN_RUN_ID}", display_name=index, origin="metadata_index", indexes=mvappend(index), confidence=0.95, last_seen=strftime(now(),"%Y-%m-%dT%H:%M:%SZ"), _slice_source="current" | fields _key dataset_id scan_run_id dataset_key display_name origin indexes confidence last_seen _slice_source
                """,
            ),
        },
        {
            "name": "Monitoring Use Cases - Discovery Sourcetype Inventory",
            "stage": "inventory_sourcetypes",
            "mode": "quick",
            "output_collection": "muc_discovered_datasets",
            "cron_schedule": "1-59/30 * * * *",
            "dispatch_earliest_time": "-1d@d",
            "dispatch_latest_time": "now",
            "description": (
                "Captures a bounded metadata inventory of sourcetypes and rewrites only "
                "the metadata_sourcetype slice of muc_discovered_datasets."
            ),
            "search": rewrite_latest_snapshot_slice(
                "metadata_sourcetype",
                f"""\
                | metadata type=sourcetypes index=* | sort 0 - totalCount | head {DISCOVERY_INVENTORY_CAPS['sourcetypes']} | eval dataset_key="sourcetype::" . sourcetype, _key=dataset_key, dataset_id=md5(dataset_key), scan_run_id="{DISCOVERY_SCAN_RUN_ID}", display_name=sourcetype, origin="metadata_sourcetype", sourcetypes=mvappend(sourcetype), confidence=0.85, last_seen=strftime(lastTime,"%Y-%m-%dT%H:%M:%SZ"), _slice_source="current" | fields _key dataset_id scan_run_id dataset_key display_name origin sourcetypes confidence last_seen _slice_source
                """,
            ),
        },
        {
            "name": "Monitoring Use Cases - Discovery Source Inventory",
            "stage": "inventory_sources",
            "mode": "quick",
            "output_collection": "muc_discovered_datasets",
            "cron_schedule": "2-59/30 * * * *",
            "dispatch_earliest_time": "-1d@d",
            "dispatch_latest_time": "now",
            "description": (
                "Captures a bounded metadata inventory of sources and rewrites only the "
                "metadata_source slice of muc_discovered_datasets."
            ),
            "search": rewrite_latest_snapshot_slice(
                "metadata_source",
                f"""\
                | metadata type=sources index=* | sort 0 - totalCount | head {DISCOVERY_INVENTORY_CAPS['sources']} | eval dataset_key="source::" . source, _key=dataset_key, dataset_id=md5(dataset_key), scan_run_id="{DISCOVERY_SCAN_RUN_ID}", display_name=source, origin="metadata_source", sources=mvappend(source), confidence=0.55, last_seen=strftime(lastTime,"%Y-%m-%dT%H:%M:%SZ"), _slice_source="current" | fields _key dataset_id scan_run_id dataset_key display_name origin sources confidence last_seen _slice_source
                """,
            ),
        },
        {
            "name": "Monitoring Use Cases - Discovery Host Inventory",
            "stage": "inventory_hosts",
            "mode": "quick",
            "output_collection": "muc_discovered_datasets",
            "cron_schedule": "3-59/30 * * * *",
            "dispatch_earliest_time": "-1d@d",
            "dispatch_latest_time": "now",
            "description": (
                "Captures a bounded metadata inventory of hosts and rewrites only the "
                "metadata_host slice of muc_discovered_datasets."
            ),
            "search": rewrite_latest_snapshot_slice(
                "metadata_host",
                f"""\
                | metadata type=hosts index=* | sort 0 - totalCount | head {DISCOVERY_INVENTORY_CAPS['hosts']} | eval dataset_key="host::" . host, _key=dataset_key, dataset_id=md5(dataset_key), scan_run_id="{DISCOVERY_SCAN_RUN_ID}", display_name=host, origin="metadata_host", hosts=mvappend(host), confidence=0.60, last_seen=strftime(lastTime,"%Y-%m-%dT%H:%M:%SZ"), _slice_source="current" | fields _key dataset_id scan_run_id dataset_key display_name origin hosts confidence last_seen _slice_source
                """,
            ),
        },
        {
            "name": "Monitoring Use Cases - Discovery Data Model Inventory",
            "stage": "inventory_cim",
            "mode": "standard",
            "output_collection": "muc_discovered_datasets",
            "cron_schedule": "4 * * * *",
            "dispatch_earliest_time": "-15m@m",
            "dispatch_latest_time": "now",
            "description": (
                "Captures a bounded inventory of Splunk data models via REST and "
                "annotates CIM-owned models plus acceleration state."
            ),
            "search": rewrite_latest_snapshot_slice(
                "rest_data_model",
                f"""\
                | rest splunk_server=local /services/data/models count=0 | eval app_name=coalesce('eai:acl.app', ""), model_name=coalesce(title, modelName, objectName, name) | where isnotnull(model_name) AND model_name!="" | sort 0 model_name | head {DISCOVERY_INVENTORY_CAPS['data_models']} | eval dataset_key="datamodel::" . model_name, _key=dataset_key, dataset_id=md5(dataset_key), scan_run_id="{DISCOVERY_SCAN_RUN_ID}", display_name=model_name, origin="rest_data_model", datamodels=mvappend(model_name), supporting_apps=mvappend(app_name), cim_models=if(match(app_name, "^(Splunk_SA_CIM|SA-CIM)$"), mvappend(model_name), null()), acceleration_state=if(tostring('acceleration.enabled')="1", "accelerated", "not_accelerated"), confidence=if(match(app_name, "^(Splunk_SA_CIM|SA-CIM)$"), 0.80, 0.65), last_seen=strftime(now(),"%Y-%m-%dT%H:%M:%SZ"), _slice_source="current" | fields _key dataset_id scan_run_id dataset_key display_name origin datamodels supporting_apps cim_models acceleration_state confidence last_seen _slice_source
                """,
            ),
        },
        {
            "name": "Monitoring Use Cases - Discovery Field Sample",
            "stage": "inventory_fields",
            "mode": "standard",
            "output_collection": "muc_discovered_datasets",
            "cron_schedule": "5 * * * *",
            "dispatch_earliest_time": "-24h@h",
            "dispatch_latest_time": "now",
            "description": (
                "Samples bounded events for the current sourcetype inventory and "
                "annotates those dataset records with observed field names."
            ),
            "search": textwrap.dedent(
                f"""\
                | inputlookup muc_discovered_datasets
                | eval dataset_key=coalesce(dataset_key, _key)
                | join type=left dataset_key [ | inputlookup muc_discovered_datasets | search origin=metadata_sourcetype scan_run_id="{DISCOVERY_SCAN_RUN_ID}" snapshot_source="current" | eval dataset_key=coalesce(dataset_key, _key), sourcetype=mvindex(sourcetypes, 0) | where isnotnull(sourcetype) AND sourcetype!="" | sort 0 sourcetype | head {DISCOVERY_INVENTORY_CAPS['field_sample_sourcetypes']} | fields dataset_key sourcetype | map maxsearches={DISCOVERY_INVENTORY_CAPS['field_sample_sourcetypes']} search="search earliest=-24h@h latest=now sourcetype=\\\"$sourcetype$\\\" | head {DISCOVERY_INVENTORY_CAPS['field_sample_events']} | fieldsummary | sort 0 - count | head {DISCOVERY_INVENTORY_CAPS['field_sample_fields']} | stats values(field) as fields by sourcetype | eval dataset_key=\\\"$dataset_key$\\\", field_sample_source=\\\"fieldsummary\\\", field_sample_size={DISCOVERY_INVENTORY_CAPS['field_sample_events']}, field_sample_limit={DISCOVERY_INVENTORY_CAPS['field_sample_fields']} | fields dataset_key fields field_sample_source field_sample_size field_sample_limit" ]
                | outputlookup muc_discovered_datasets append=false
                """
            ).strip(),
        },
        {
            "name": "Monitoring Use Cases - Discovery Telemetry Snapshot",
            "stage": "inventory_telemetry",
            "mode": "standard",
            "output_collection": "muc_scan_logs",
            "cron_schedule": "6 * * * *",
            "dispatch_earliest_time": "-15m@m",
            "dispatch_latest_time": "now",
            "description": (
                "Writes bounded stage-level telemetry into muc_scan_logs for the "
                "latest discovery snapshot."
            ),
            "search": textwrap.dedent(
                f"""\
                | makeresults
                | eval stage_rows="inventory_indexes,Index inventory;inventory_sourcetypes,Sourcetype inventory;inventory_sources,Source inventory;inventory_hosts,Host inventory;inventory_cim,Data model inventory;inventory_fields,Field sampling"
                | appendcols [ | inputlookup muc_discovered_datasets | search scan_run_id="{DISCOVERY_SCAN_RUN_ID}" snapshot_source="current" | stats count(eval(origin="metadata_index")) as metadata_index_count count(eval(origin="metadata_sourcetype")) as metadata_sourcetype_count count(eval(origin="metadata_source")) as metadata_source_count count(eval(origin="metadata_host")) as metadata_host_count count(eval(origin="rest_data_model")) as rest_data_model_count count(eval(isnotnull(fields) AND mvcount(fields)>0)) as field_sampled_count ]
                | makemv delim=";" stage_rows
                | mvexpand stage_rows
                | rex field=stage_rows "(?<stage>[^,]+),(?<stage_label>.+)"
                | eval record_count=case(stage="inventory_indexes", metadata_index_count, stage="inventory_sourcetypes", metadata_sourcetype_count, stage="inventory_sources", metadata_source_count, stage="inventory_hosts", metadata_host_count, stage="inventory_cim", rest_data_model_count, stage="inventory_fields", field_sampled_count, true(), 0)
                | eval scan_run_id="{DISCOVERY_SCAN_RUN_ID}", log_id=scan_run_id . "::" . stage, logged_at=strftime(now(),"%Y-%m-%dT%H:%M:%SZ"), level=if(coalesce(record_count, 0)>0, "info", "warning"), message=stage_label . " produced " . tostring(coalesce(record_count, 0)) . " records in the latest snapshot", details_json="{{\\\"record_count\\\":" . tostring(coalesce(record_count, 0)) . "}}"
                | fields _key log_id scan_run_id stage level logged_at message record_count details_json
                | append [ | inputlookup muc_scan_logs | search scan_run_id="{DISCOVERY_SCAN_RUN_ID}" level="error" | fields _key log_id scan_run_id stage level logged_at message record_count details_json ]
                | outputlookup muc_scan_logs append=false
                """
            ).strip(),
        },
        {
            "name": "Monitoring Use Cases - Discovery Inventory Summary",
            "stage": "inventory_summary",
            "mode": "standard",
            "output_collection": "muc_scan_runs",
            "cron_schedule": "8-59/30 * * * *",
            "dispatch_earliest_time": "-15m@m",
            "dispatch_latest_time": "now",
            "description": (
                "Writes a latest-snapshot scan_run summary from the current metadata "
                "inventory, field sampling, and data-model inspection without deleting "
                "prior non-snapshot run records."
            ),
            "search": textwrap.dedent(
                f"""\
                | inputlookup muc_scan_runs
                | search NOT scan_run_id={DISCOVERY_SCAN_RUN_ID}
                | append [
                | makeresults
                | eval scan_run_id="{DISCOVERY_SCAN_RUN_ID}", _key=scan_run_id, status="complete", mode="standard", started_at=strftime(now(),"%Y-%m-%dT%H:%M:%SZ"), completed_at=strftime(now(),"%Y-%m-%dT%H:%M:%SZ"), use_cases_direct=0, use_cases_adjacent=0, use_cases_partial=0, use_cases_none=0
                | appendcols [ | inputlookup muc_discovered_datasets | search scan_run_id="{DISCOVERY_SCAN_RUN_ID}" snapshot_source="current" | stats count as datasets_discovered ]
                | appendcols [ | inputlookup muc_scan_runs | search scan_run_id="{DISCOVERY_SCAN_RUN_ID}" status="complete" | sort 0 - completed_at | head 1 | stats max(datasets_discovered) as prior_datasets_discovered max(use_cases_direct) as prior_use_cases_direct max(use_cases_adjacent) as prior_use_cases_adjacent max(use_cases_partial) as prior_use_cases_partial max(use_cases_none) as prior_use_cases_none ]
                | appendcols [ | inputlookup muc_scan_logs | search scan_run_id="{DISCOVERY_SCAN_RUN_ID}" | stats count(eval(level!="error")) as telemetry_stage_count max(eval(case(level!="error", logged_at, true(), null()))) as latest_telemetry_logged_at max(eval(case(stage="inventory_indexes" AND level!="error", record_count, true(), null()))) as metadata_index_count max(eval(case(stage="inventory_sourcetypes" AND level!="error", record_count, true(), null()))) as metadata_sourcetype_count max(eval(case(stage="inventory_sources" AND level!="error", record_count, true(), null()))) as metadata_source_count max(eval(case(stage="inventory_hosts" AND level!="error", record_count, true(), null()))) as metadata_host_count max(eval(case(stage="inventory_cim" AND level!="error", record_count, true(), null()))) as rest_data_model_count max(eval(case(stage="inventory_fields" AND level!="error", record_count, true(), null()))) as field_sampled_count ]
                | appendcols [ | inputlookup muc_scan_logs | search scan_run_id="{DISCOVERY_SCAN_RUN_ID}" level="error" | sort 0 - logged_at | head 1 | eval logged_error_at=logged_at, logged_error_details=coalesce(details_json, "null") | fields stage message logged_error_at logged_error_details | rename stage as logged_failed_stage message as logged_error_message ]
                | eval active_logged_failed_stage=if(isnotnull(logged_failed_stage) AND (isnull(latest_telemetry_logged_at) OR latest_telemetry_logged_at="" OR logged_error_at>=latest_telemetry_logged_at), logged_failed_stage, null()), active_logged_error_message=if(isnotnull(active_logged_failed_stage), logged_error_message, null()), active_logged_error_details=if(isnotnull(active_logged_failed_stage), coalesce(logged_error_details, "null"), "null")
                | eval datasets_discovered_current=coalesce(datasets_discovered, 0), telemetry_stage_count=coalesce(telemetry_stage_count, 0), metadata_index_count=coalesce(metadata_index_count, 0), metadata_sourcetype_count=coalesce(metadata_sourcetype_count, 0), metadata_source_count=coalesce(metadata_source_count, 0), metadata_host_count=coalesce(metadata_host_count, 0), rest_data_model_count=coalesce(rest_data_model_count, 0), field_sampled_count=coalesce(field_sampled_count, 0), logged_error_details=coalesce(logged_error_details, "null"), gap_failed_stage=case(telemetry_stage_count=0, "inventory_telemetry", metadata_index_count=0, "inventory_indexes", metadata_index_count>0 AND metadata_sourcetype_count=0, "inventory_sourcetypes", metadata_sourcetype_count>0 AND metadata_source_count=0, "inventory_sources", metadata_sourcetype_count>0 AND metadata_host_count=0, "inventory_hosts", metadata_sourcetype_count>0 AND rest_data_model_count=0, "inventory_cim", metadata_sourcetype_count>0 AND field_sampled_count=0, "inventory_fields", true(), null()), failed_stage=coalesce(active_logged_failed_stage, gap_failed_stage), status=case(isnotnull(active_logged_failed_stage), "failed", isnotnull(gap_failed_stage), "degraded", true(), status), datasets_discovered=if(isnotnull(failed_stage), coalesce(prior_datasets_discovered, datasets_discovered_current), datasets_discovered_current), use_cases_direct=if(isnotnull(failed_stage), coalesce(prior_use_cases_direct, use_cases_direct), use_cases_direct), use_cases_adjacent=if(isnotnull(failed_stage), coalesce(prior_use_cases_adjacent, use_cases_adjacent), use_cases_adjacent), use_cases_partial=if(isnotnull(failed_stage), coalesce(prior_use_cases_partial, use_cases_partial), use_cases_partial), use_cases_none=if(isnotnull(failed_stage), coalesce(prior_use_cases_none, use_cases_none), use_cases_none), gap_error_message=case(failed_stage="inventory_telemetry", "Stage telemetry produced no records; preserving prior successful snapshot summary where available.", failed_stage="inventory_indexes", "Index inventory produced no records; preserving prior successful snapshot summary where available.", failed_stage="inventory_sourcetypes", "Sourcetype inventory produced no records after index inventory; preserving prior successful snapshot summary where available.", failed_stage="inventory_sources", "Source inventory produced no records after sourcetype inventory; preserving prior successful snapshot summary where available.", failed_stage="inventory_hosts", "Host inventory produced no records after sourcetype inventory; preserving prior successful snapshot summary where available.", failed_stage="inventory_cim", "Data model inventory produced no records after sourcetype inventory; preserving prior successful snapshot summary where available.", failed_stage="inventory_fields", "Field sampling produced no records; preserving prior successful snapshot summary where available.", true(), null()), error_summary=coalesce(active_logged_error_message, gap_error_message)
                | eval gap_error_details=if(isnotnull(gap_failed_stage), printf("{{\\\"kind\\\":\\\"gap\\\",\\\"stage\\\":\\\"%s\\\",\\\"message\\\":\\\"%s\\\",\\\"telemetry_stage_count\\\":%s,\\\"metadata_index_count\\\":%s,\\\"metadata_sourcetype_count\\\":%s,\\\"metadata_source_count\\\":%s,\\\"metadata_host_count\\\":%s,\\\"rest_data_model_count\\\":%s,\\\"field_sampled_count\\\":%s}}", coalesce(failed_stage, ""), gap_error_message, tostring(telemetry_stage_count), tostring(metadata_index_count), tostring(metadata_sourcetype_count), tostring(metadata_source_count), tostring(metadata_host_count), tostring(rest_data_model_count), tostring(field_sampled_count)), "null"), failure_record_json=case(isnotnull(active_logged_failed_stage), active_logged_error_details, isnotnull(gap_failed_stage), gap_error_details, true(), "null"), summary_json=printf("{{\\\"datasets_discovered\\\":%s,\\\"observed_datasets_discovered\\\":%s,\\\"telemetry_stage_count\\\":%s,\\\"metadata_index_count\\\":%s,\\\"metadata_sourcetype_count\\\":%s,\\\"metadata_source_count\\\":%s,\\\"metadata_host_count\\\":%s,\\\"rest_data_model_count\\\":%s,\\\"field_sampled_count\\\":%s,\\\"failed_stage\\\":\\\"%s\\\",\\\"error_record\\\":%s,\\\"preserved_snapshot\\\":%s}}", tostring(datasets_discovered), tostring(datasets_discovered_current), tostring(telemetry_stage_count), tostring(metadata_index_count), tostring(metadata_sourcetype_count), tostring(metadata_source_count), tostring(metadata_host_count), tostring(rest_data_model_count), tostring(field_sampled_count), coalesce(failed_stage, ""), failure_record_json, if(isnotnull(failed_stage), "true", "false"))
                | fields _key scan_run_id status mode started_at completed_at failed_stage summary_json datasets_discovered use_cases_direct use_cases_adjacent use_cases_partial use_cases_none error_summary ]
                | outputlookup muc_scan_runs append=false
                """
            ).strip(),
        },
    ]


def _savedsearches_conf() -> str:
    def serialize_setting(key: str, value: str) -> str:
        lines = value.splitlines()
        if not lines:
            return f"{key} ="
        if len(lines) == 1:
            return f"{key} = {lines[0]}"
        return "\n".join([f"{key} = {lines[0]}", *[f" {line}" for line in lines[1:]]])

    def serialize_search(value: str) -> str:
        return serialize_setting(
            "search",
            " ".join(line.strip() for line in value.splitlines() if line.strip()),
        )

    blocks: List[str] = [
        textwrap.dedent(
            """\
            # -----------------------------------------------------------------
            # GENERATED by scripts/generate_monitoring_use_cases_app.py — DO NOT EDIT.
            # Source of truth: scripts/generate_monitoring_use_cases_app.py.
            # Re-run `python3 scripts/generate_monitoring_use_cases_app.py` after edits.
            # -----------------------------------------------------------------
            """
        ).rstrip()
    ]
    for savedsearch in _discovery_savedsearches():
        blocks.append(
            "\n".join(
                [
                    f"[{savedsearch['name']}]",
                    serialize_setting("description", savedsearch["description"]),
                    serialize_search(savedsearch["search"]),
                    serialize_setting("cron_schedule", savedsearch["cron_schedule"]),
                    serialize_setting(
                        "dispatch.earliest_time",
                        savedsearch["dispatch_earliest_time"],
                    ),
                    serialize_setting(
                        "dispatch.latest_time",
                        savedsearch["dispatch_latest_time"],
                    ),
                    "enableSched = 1",
                    "is_scheduled = 1",
                    "disabled = 0",
                    "alert.track = 0",
                    "action.email = 0",
                    "action.logevent = 0",
                ]
            )
        )
    return "\n\n".join(blocks) + "\n"


def _discovery_bootstrap(
    meta: BuildMetadata,
    requirements_payload: Dict[str, object],
) -> Dict[str, object]:
    collections = [
        {
            "name": collection["name"],
            "schema": collection["schema"],
            "purpose": collection["purpose"],
            "primaryKey": collection["primary_key"],
        }
        for collection in DISCOVERY_COLLECTIONS
    ]
    return {
        "schemaVersion": "1.0.0",
        "generatedAt": meta.generated_at,
        "catalogVersion": meta.version,
        "appId": APP_ID,
        "track": "discovery",
        "runtimeModel": {
            "inventory": "saved-search-and-kv-store",
            "orchestration": "browser-splunkjs",
            "customRestEndpoints": "deferred",
            "rationale": (
                "monitoring_use_cases is generator-owned and static-first, while "
                "splunk-uc-recommender already proves a Cloud-safe discovery "
                "pattern with collections.conf, savedsearches.conf, and browser-side "
                "SplunkJS without a primary-app bin or restmap surface."
            ),
        },
        "stateVocabulary": {
            "engineStates": list(DISCOVERY_ENGINE_STATES),
            "effectiveStates": list(DISCOVERY_EFFECTIVE_STATES),
            "overrideTypes": list(DISCOVERY_OVERRIDE_TYPES),
        },
        "artifacts": {
            "requirementProfiles": REQUIREMENTS_ENDPOINT,
        },
        "counts": {
            "requirementProfiles": requirements_payload.get("profileCount", 0),
            "catalogFallbackProfiles": requirements_payload.get("catalogFallbackCount", 0),
        },
        "discoveryEngine": {
            "latestSnapshotRunId": DISCOVERY_SCAN_RUN_ID,
            "scanModes": list(DISCOVERY_SCAN_MODES),
            "inventoryCaps": dict(DISCOVERY_INVENTORY_CAPS),
            "savedSearches": [
                {
                    "name": savedsearch["name"],
                    "stage": savedsearch["stage"],
                    "mode": savedsearch["mode"],
                    "outputCollection": savedsearch["output_collection"],
                    "cronSchedule": savedsearch["cron_schedule"],
                }
                for savedsearch in _discovery_savedsearches()
            ],
        },
        "collections": collections,
        "schemas": {
            "requirementProfile": {
                "type": "object",
                "required": [
                    "use_case_id",
                    "schema_version",
                    "title",
                    "generated_at",
                    "requirements",
                ],
                "properties": {
                    "use_case_id": {"type": "string"},
                    "schema_version": {"type": "string"},
                    "title": {"type": "string"},
                    "category": {"type": "string"},
                    "generated_at": {"type": "string"},
                    "requirements": {"type": "object"},
                    "normalization_hints": {"type": "object"},
                    "source_refs": {"type": "array", "items": {"type": "string"}},
                },
                "additionalProperties": False,
            },
            "discoveredDataset": {
                "type": "object",
                "required": [
                    "dataset_id",
                    "scan_run_id",
                    "dataset_key",
                    "display_name",
                    "origin",
                ],
                "properties": {
                    "dataset_id": {"type": "string"},
                    "scan_run_id": {"type": "string"},
                    "dataset_key": {"type": "string"},
                    "display_name": {"type": "string"},
                    "origin": {"type": "string"},
                    "snapshot_source": {"type": "string", "enum": ["current", "prior"]},
                    "datamodels": {"type": "array", "items": {"type": "string"}},
                    "fields": {"type": "array", "items": {"type": "string"}},
                    "indexes": {"type": "array", "items": {"type": "string"}},
                    "sources": {"type": "array", "items": {"type": "string"}},
                    "sourcetypes": {"type": "array", "items": {"type": "string"}},
                    "hosts": {"type": "array", "items": {"type": "string"}},
                    "cim_models": {"type": "array", "items": {"type": "string"}},
                    "supporting_apps": {"type": "array", "items": {"type": "string"}},
                    "acceleration_state": {"type": "string"},
                    "field_sample_source": {"type": "string"},
                    "field_sample_size": {"type": "number"},
                    "field_sample_limit": {"type": "number"},
                    "field_summary": {"type": "object"},
                    "confidence": {"type": "number"},
                    "last_seen": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "useCaseMapping": {
                "type": "object",
                "required": [
                    "use_case_id",
                    "scan_run_id",
                    "engine_state",
                    "effective_state",
                ],
                "properties": {
                    "use_case_id": {"type": "string"},
                    "scan_run_id": {"type": "string"},
                    "engine_state": {"type": "string", "enum": list(DISCOVERY_ENGINE_STATES)},
                    "effective_state": {"type": "string", "enum": list(DISCOVERY_EFFECTIVE_STATES)},
                    "matched_dataset_ids": {"type": "array", "items": {"type": "string"}},
                    "evidence": {"type": "array", "items": {"type": "object"}},
                    "missing_requirements": {"type": "array", "items": {"type": "string"}},
                    "precedence_reason": {"type": "string"},
                    "updated_at": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "mappingOverride": {
                "type": "object",
                "required": [
                    "override_id",
                    "use_case_id",
                    "override_type",
                    "note",
                    "created_by",
                    "created_at",
                    "active",
                ],
                "properties": {
                    "override_id": {"type": "string"},
                    "use_case_id": {"type": "string"},
                    "dataset_id": {"type": ["string", "null"]},
                    "override_type": {"type": "string", "enum": list(DISCOVERY_OVERRIDE_TYPES)},
                    "note": {"type": "string"},
                    "created_by": {"type": "string"},
                    "created_at": {"type": "string"},
                    "active": {"type": "boolean"},
                },
                "additionalProperties": False,
            },
            "scanRun": {
                "type": "object",
                "required": [
                    "scan_run_id",
                    "status",
                    "mode",
                    "started_at",
                ],
                "properties": {
                    "scan_run_id": {"type": "string"},
                    "status": {"type": "string", "enum": ["queued", "running", "failed", "degraded", "complete"]},
                    "mode": {"type": "string"},
                    "started_at": {"type": "string"},
                    "completed_at": {"type": ["string", "null"]},
                    "failed_stage": {"type": ["string", "null"]},
                    "summary_json": {"type": ["string", "null"]},
                    "datasets_discovered": {"type": "number"},
                    "use_cases_direct": {"type": "number"},
                    "use_cases_adjacent": {"type": "number"},
                    "use_cases_partial": {"type": "number"},
                    "use_cases_none": {"type": "number"},
                    "error_summary": {"type": ["string", "null"]},
                },
                "additionalProperties": False,
            },
            "scanLog": {
                "type": "object",
                "required": [
                    "log_id",
                    "scan_run_id",
                    "stage",
                    "level",
                    "logged_at",
                    "message",
                ],
                "properties": {
                    "log_id": {"type": "string"},
                    "scan_run_id": {"type": "string"},
                    "stage": {"type": "string"},
                    "level": {"type": "string", "enum": ["info", "warning", "error"]},
                    "logged_at": {"type": "string"},
                    "message": {"type": "string"},
                    "record_count": {"type": "number"},
                    "details_json": {"type": "string"},
                },
                "additionalProperties": False,
            },
            "adjacencyRegistry": {
                "type": "object",
                "required": [
                    "adjacency_id",
                    "source_key",
                    "target_key",
                    "relation_type",
                    "weight",
                ],
                "properties": {
                    "adjacency_id": {"type": "string"},
                    "source_key": {"type": "string"},
                    "target_key": {"type": "string"},
                    "relation_type": {"type": "string"},
                    "weight": {"type": "number"},
                    "evidence": {"type": "array", "items": {"type": "object"}},
                    "updated_at": {"type": "string"},
                },
                "additionalProperties": False,
            },
        },
    }


def _nav_default_xml() -> str:
    links = "\n".join(
        f'    <view name="{view_name}" />' for _, view_name, _, _ in STATIC_LINKS
    )
    return textwrap.dedent(
        f"""\
        <!-- GENERATED by scripts/generate_monitoring_use_cases_app.py — DO NOT EDIT. -->
        <nav>
          <view name="catalog" default="true" />
          <collection label="Static Pages">
        {links}
          </collection>
        </nav>
        """
    )


def _host_view_xml(label: str, description: str, target_path: str, target_hash: str = "") -> str:
    return textwrap.dedent(
        f"""\
        <!-- GENERATED by scripts/generate_monitoring_use_cases_app.py — DO NOT EDIT. -->
                <dashboard version="1.1" theme="light" script="{HOST_SCRIPT_NAME}" stylesheet="{HOST_STYLESHEET_NAME}">
                    <label>{label}</label>
                    <description>{description}</description>
          <row>
            <panel>
              <html>
                                <div id="monitoring-use-cases-host"
                                         data-target-path="{target_path}"
                                         data-target-hash="{target_hash}">
                                    <p><em>Loading Monitoring Use Cases...</em></p>
                                </div>
              </html>
            </panel>
          </row>
        </dashboard>
        """
    )


def _host_view_js() -> str:
        return textwrap.dedent(
                f"""\
                /* GENERATED by scripts/generate_monitoring_use_cases_app.py — DO NOT EDIT. */
                (function () {{
                    'use strict';

                    var APP_ID = '{APP_ID}';
                    var FRAME_ID = 'monitoring-use-cases-frame';
                    var HOST_ID = 'monitoring-use-cases-host';

                    function webBase() {{
                        var match = window.location.pathname.match(/^\\/[^/]+/);
                        return match ? match[0] : '';
                    }}

                    function normalizePath(value) {{
                        var path = String(value || 'index.html').replace(/^\\/+/, '');
                        return path || 'index.html';
                    }}

                    function normalizeHash(value) {{
                        var hash = String(value || '').replace(/^#+/, '');
                        return hash ? '#' + hash : '';
                    }}

                    function buildStaticUrl(path, hash) {{
                        return webBase() + '/static/app/' + APP_ID + '/' + normalizePath(path) + normalizeHash(hash);
                    }}

                    function buildSearchUrl(query, earliest, latest) {{
                        return webBase()
                            + '/app/search/search?q=' + encodeURIComponent(String(query || ''))
                            + '&earliest=' + encodeURIComponent(String(earliest || '-24h'))
                            + '&latest=' + encodeURIComponent(String(latest || 'now'));
                    }}

                    function renderFrame(host) {{
                        var targetPath = host.getAttribute('data-target-path') || 'index.html';
                        var targetHash = host.getAttribute('data-target-hash') || '';
                        host.innerHTML = '';
                        var frame = document.createElement('iframe');
                        frame.id = FRAME_ID;
                        frame.title = 'Monitoring Use Cases Catalog';
                        frame.src = buildStaticUrl(targetPath, targetHash);
                        frame.setAttribute('loading', 'eager');
                        frame.setAttribute('referrerpolicy', 'same-origin');
                        host.appendChild(frame);
                        return frame;
                    }}

                    function handleBridgeMessage(event, frame) {{
                        if (!event || event.origin !== window.location.origin) return;
                        var payload = event.data || {{}};
                        if (!payload || payload.source !== 'monitoring_use_cases') return;

                        if (payload.type === 'open-search' && payload.query) {{
                            window.location.assign(buildSearchUrl(payload.query, payload.earliest, payload.latest));
                            return;
                        }}

                        if (payload.type === 'open-static' && payload.path) {{
                            frame.src = buildStaticUrl(payload.path, payload.hash || '');
                        }}
                    }}

                    function init() {{
                        var host = document.getElementById(HOST_ID);
                        if (!host) return;
                        var frame = renderFrame(host);
                        window.addEventListener('message', function (event) {{
                            handleBridgeMessage(event, frame);
                        }});
                    }}

                    if (document.readyState === 'loading') {{
                        document.addEventListener('DOMContentLoaded', init);
                    }} else {{
                        init();
                    }}
                }})();
                """
        )


def _host_view_css() -> str:
        return textwrap.dedent(
                """\
                /* GENERATED by scripts/generate_monitoring_use_cases_app.py — DO NOT EDIT. */
                #monitoring-use-cases-host {
                    width: 100%;
                    min-height: calc(100vh - 220px);
                    border: 1px solid #d8d8d8;
                    border-radius: 6px;
                    background: #ffffff;
                    overflow: hidden;
                }

                #monitoring-use-cases-frame {
                    display: block;
                    width: 100%;
                    min-height: calc(100vh - 220px);
                    height: calc(100vh - 180px);
                    border: 0;
                    background: #ffffff;
                }
                """
        )


def _default_meta() -> str:
    return textwrap.dedent(
        """\
        # Default export permissions. Regenerated by scripts/generate_monitoring_use_cases_app.py.
        []
        access = read : [ * ], write : [ admin, power ]
        export = app

        [collections]
        export = system

        [savedsearches]
        export = app

        [views]
        export = user

        [nav]
        export = user
        """
    )


def _readme(meta: BuildMetadata) -> str:
    excluded = ", ".join(f"`{name}/`" for name in sorted(EXCLUDED_TOP_LEVEL))
    return textwrap.dedent(
        f"""\
        # {APP_TITLE}

        App ID: `{APP_ID}`  
        App version: **{meta.version}**  
        Generated: `{meta.generated_at}`  
        Source commit: `{meta.git_sha}`  
        Catalog size: **{meta.use_case_count:,}** use cases

        This app packages the compiled Monitoring Use Cases site into an installable
        Splunk app. The runtime entry point is:

        - `{APP_STATIC_BASE}/index.html#overview`

        The app is generated from `python3 tools/build/build.py --reproducible`
        with `SITE_URL` set to `{SITE_URL}` so the compiled site resolves assets,
        API files, and companion pages from the Splunk static app root.

        ## What ships in this app

        - the compiled overview experience from `index.html`
        - API-backed search/filtering assets under `appserver/static/api/`
        - companion pages including `scorecard.html`, `regulatory-primer.html`, `clause-navigator.html`, `compliance-story.html`, and `api-docs.html`
        - discovery bootstrap schemas and runtime contract under `appserver/static/api/v1/discovery/bootstrap.json`
        - deterministic requirement profiles for discovery and mapping under `appserver/static/api/v1/discovery/requirements.json`
        - generator-owned KV store definitions in `default/collections.conf` for the upcoming discovery and mapping feature track
        - generator-owned discovery inventory saved searches in `default/savedsearches.conf` for the first bounded Phase 3 metadata scan scaffold
        - supporting docs, reports, data files, and the data sizing tool under `tools/data-sizing/`

        To keep the app package smaller, the generator intentionally excludes the
        largest non-essential export trees for Release 1: {excluded}.

        ## Generate

        ```bash
        python3 scripts/generate_monitoring_use_cases_app.py
        python3 scripts/generate_monitoring_use_cases_app.py --check
        ```

        ## Package

        ```bash
        scripts/package_splunk_apps.sh dist monitoring_use_cases
        ```

        Upload the resulting `.spl` archive via **Settings > Manage Apps > Install app from file**,
        then open **Apps > Monitoring Use Cases**.

        The Splunk-facing route is a scripted dashboard host that keeps the catalog
        and companion pages inside Splunk chrome while loading the compiled site from
        `{APP_STATIC_BASE}/`.

        ## Files in this app

        ```text
        monitoring_use_cases/
        ├── app.manifest
        ├── README.md
        ├── LICENSE
        ├── default/
        │   ├── app.conf
        │   ├── collections.conf
        │   ├── transforms.conf
        │   ├── savedsearches.conf
        │   └── data/ui/
        │       ├── nav/default.xml
        │       └── views/catalog.xml
        ├── metadata/default.meta
        └── appserver/static/
            ├── index.html
            ├── {HOST_STYLESHEET_NAME}
            ├── {HOST_SCRIPT_NAME}
            ├── api/
            │   └── v1/discovery/{{bootstrap.json,requirements.json}}
            ├── assets/
            ├── docs/
            ├── reports/
            └── tools/data-sizing/
        ```

        ---

        _This app is generated. Edits in place will be overwritten. File bug
        reports and content requests at
        <https://github.com/fenre/splunk-monitoring-use-cases/issues>._
        """
    )


def _build_app(out_root: pathlib.Path) -> pathlib.Path:
    app_root = out_root / APP_ID
    if app_root.exists():
        shutil.rmtree(app_root)
    app_root.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        site_root = pathlib.Path(tmp) / "site"
        meta = _build_site(site_root)
        _copy_site_subset(site_root, app_root / "appserver" / "static")
        requirements_payload = build_discovery_requirement_payload(
            PROJECT_ROOT,
            generated_at=meta.generated_at,
            catalog_version=meta.version,
        )
        _write_json(
            app_root / "appserver" / "static" / "api" / "v1" / "discovery" / "bootstrap.json",
            _discovery_bootstrap(meta, requirements_payload),
        )
        _write_json(
            app_root / "appserver" / "static" / "api" / "v1" / "discovery" / "requirements.json",
            requirements_payload,
        )

    _write_json(app_root / "app.manifest", _app_manifest(meta))
    _write_text(app_root / "default" / "app.conf", _app_conf(meta))
    _write_text(app_root / "default" / "collections.conf", _collections_conf())
    _write_text(app_root / "default" / "transforms.conf", _transforms_conf())
    _write_text(app_root / "default" / "savedsearches.conf", _savedsearches_conf())
    _write_text(
        app_root / "default" / "data" / "ui" / "nav" / "default.xml",
        _nav_default_xml(),
    )
    _write_text(
        app_root / "default" / "data" / "ui" / "views" / "catalog.xml",
        _host_view_xml(
            label="Catalog",
            description="Open the compiled Monitoring Use Cases catalog inside Splunk chrome.",
            target_path="index.html",
            target_hash="overview",
        ),
    )
    for label, view_name, path, target_hash in STATIC_LINKS:
        _write_text(
            app_root / "default" / "data" / "ui" / "views" / f"{view_name}.xml",
            _host_view_xml(
                label=label,
                description=f"Open {label.lower()} inside Splunk chrome.",
                target_path=path,
                target_hash=target_hash,
            ),
        )
    _write_text(
        app_root / "appserver" / "static" / HOST_SCRIPT_NAME,
        _host_view_js(),
    )
    _write_text(
        app_root / "appserver" / "static" / HOST_STYLESHEET_NAME,
        _host_view_css(),
    )
    _write_text(app_root / "metadata" / "default.meta", _default_meta())
    _write_text(app_root / "README.md", _readme(meta))

    if ROOT_LICENSE.exists():
        shutil.copy2(ROOT_LICENSE, app_root / "LICENSE")

    return app_root


def _diff_trees(lhs: pathlib.Path, rhs: pathlib.Path) -> List[str]:
    diffs: List[str] = []
    lhs_files = {p.relative_to(lhs) for p in lhs.rglob("*") if p.is_file()}
    rhs_files = {p.relative_to(rhs) for p in rhs.rglob("*") if p.is_file()}
    for rel_path in sorted(lhs_files - rhs_files):
        diffs.append(f"+ {rel_path}  (only in freshly generated tree)")
    for rel_path in sorted(rhs_files - lhs_files):
        diffs.append(f"- {rel_path}  (only on disk)")
    for rel_path in sorted(lhs_files & rhs_files):
        if (lhs / rel_path).read_bytes() != (rhs / rel_path).read_bytes():
            diffs.append(f"  differs: {rel_path}")
    return diffs


def _scope_check_diff(expected: pathlib.Path, on_disk: pathlib.Path, apps: Iterable[str]) -> List[str]:
    diffs: List[str] = []
    for app in apps:
        if (expected / app).exists():
            diffs.extend(_diff_trees(expected / app, on_disk / app))
    return diffs


def _render(out_root: pathlib.Path) -> Dict[str, pathlib.Path]:
    built = {APP_ID: _build_app(out_root)}
    return built


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Generate the monitoring_use_cases Splunk app tree from the compiled "
            "static catalog. Deterministic; use --check in CI."
        )
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=DEFAULT_OUTPUT,
        help="Output directory (default: splunk-apps/).",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help=(
            "Regenerate into a temp dir and diff against --output. "
            "Exits 1 on drift so CI can gate PRs."
        ),
    )
    args = parser.parse_args()

    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_root = pathlib.Path(tmp) / "splunk-apps"
            _render(tmp_root)
            diffs = _scope_check_diff(tmp_root, args.output, [APP_ID])
            if diffs:
                sys.stderr.write(
                    "monitoring_use_cases tree drift — regenerate with "
                    "`python3 scripts/generate_monitoring_use_cases_app.py` and commit:\n"
                )
                for line in diffs[:200]:
                    sys.stderr.write(line + "\n")
                if len(diffs) > 200:
                    sys.stderr.write(f"... {len(diffs) - 200} additional diffs omitted\n")
                return 1
            sys.stdout.write("monitoring_use_cases app is up to date.\n")
            return 0

    built = _render(args.output)
    total_files = 0
    for app, path in built.items():
        file_count = sum(1 for candidate in path.rglob("*") if candidate.is_file())
        total_files += file_count
        sys.stdout.write(f"  {app}: {file_count} files at {path}\n")
    sys.stdout.write(
        f"Wrote {len(built)} app ({total_files} files) under {args.output}\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())