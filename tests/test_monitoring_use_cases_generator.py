from __future__ import annotations

import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from generate_monitoring_use_cases_app import (
    DISCOVERY_SCAN_RUN_ID,
    BuildMetadata,
    _copy_path,
    _copy_site_subset,
    _app_conf,
    _discovery_bootstrap,
    _savedsearches_conf,
    _transforms_conf,
)


class MonitoringUseCasesGeneratorTest(unittest.TestCase):
    def test_bootstrap_exposes_inventory_scaffold_contract(self) -> None:
        bootstrap = _discovery_bootstrap(
            BuildMetadata(
                version="1.2.3",
                generated_at="2026-04-22T00:00:00Z",
                git_sha="deadbeef",
                use_case_count=6472,
            ),
            {"profileCount": 6472, "catalogFallbackCount": 25},
        )

        discovery_engine = bootstrap["discoveryEngine"]
        self.assertEqual(discovery_engine["latestSnapshotRunId"], DISCOVERY_SCAN_RUN_ID)
        self.assertEqual(discovery_engine["inventoryCaps"]["sources"], 5000)
        self.assertEqual(discovery_engine["inventoryCaps"]["data_models"], 256)
        self.assertEqual(discovery_engine["inventoryCaps"]["field_sample_fields"], 20)
        self.assertEqual(
            {savedsearch["stage"] for savedsearch in discovery_engine["savedSearches"]},
            {
                "inventory_indexes",
                "inventory_sourcetypes",
                "inventory_sources",
                "inventory_hosts",
                "inventory_cim",
                "inventory_fields",
                "inventory_telemetry",
                "inventory_summary",
            },
        )
        self.assertIn("fields", bootstrap["schemas"]["discoveredDataset"]["properties"])
        self.assertIn("datamodels", bootstrap["schemas"]["discoveredDataset"]["properties"])
        self.assertIn("snapshot_source", bootstrap["schemas"]["discoveredDataset"]["properties"])
        self.assertIn("record_count", bootstrap["schemas"]["scanLog"]["properties"])
        self.assertIn("details_json", bootstrap["schemas"]["scanLog"]["properties"])
        self.assertIn("failed_stage", bootstrap["schemas"]["scanRun"]["properties"])
        self.assertIn("summary_json", bootstrap["schemas"]["scanRun"]["properties"])
        self.assertIn("degraded", bootstrap["schemas"]["scanRun"]["properties"]["status"]["enum"])
        self.assertIn(
            "supporting_apps",
            bootstrap["schemas"]["discoveredDataset"]["properties"],
        )

    def test_savedsearches_conf_emits_bounded_inventory_stanzas(self) -> None:
        conf = _savedsearches_conf()

        self.assertIn("[Monitoring Use Cases - Discovery Index Inventory]", conf)
        self.assertIn("[Monitoring Use Cases - Discovery Data Model Inventory]", conf)
        self.assertIn("[Monitoring Use Cases - Discovery Field Sample]", conf)
        self.assertIn("[Monitoring Use Cases - Discovery Telemetry Snapshot]", conf)
        self.assertIn("[Monitoring Use Cases - Discovery Inventory Summary]", conf)
        self.assertIn("head 5000", conf)
        self.assertIn("head 256", conf)
        self.assertIn("fieldsummary", conf)
        self.assertIn("map maxsearches=24", conf)
        self.assertIn('sourcetype=\\"$sourcetype$\\"', conf)
        self.assertIn('dataset_key=\\"$dataset_key$\\"', conf)
        self.assertIn("outputlookup muc_scan_logs append=false", conf)
        self.assertIn("metadata_index_count", conf)
        self.assertIn("metadata_source_count", conf)
        self.assertIn("metadata_host_count", conf)
        self.assertIn("prior_datasets_discovered", conf)
        self.assertIn("field_sampled_count", conf)
        self.assertIn('details_json="{\\"record_count\\":', conf)
        self.assertIn('inputlookup muc_scan_logs | search scan_run_id="inventory_snapshot_latest" level="error" | fields _key log_id scan_run_id stage level logged_at message record_count details_json', conf)
        self.assertIn('search scan_run_id="inventory_snapshot_latest" level="error" | sort 0 - logged_at | head 1', conf)
        self.assertIn('stats count(eval(level!="error")) as telemetry_stage_count', conf)
        self.assertIn('max(eval(case(level!="error", logged_at, true(), null()))) as latest_telemetry_logged_at', conf)
        self.assertIn('stage="inventory_indexes" AND level!="error", record_count', conf)
        self.assertIn('eval logged_error_at=logged_at, logged_error_details=coalesce(details_json, "null")', conf)
        self.assertIn('active_logged_failed_stage=if(isnotnull(logged_failed_stage) AND (isnull(latest_telemetry_logged_at) OR latest_telemetry_logged_at="" OR logged_error_at>=latest_telemetry_logged_at), logged_failed_stage, null())', conf)
        self.assertIn('gap_failed_stage=case(telemetry_stage_count=0, "inventory_telemetry", metadata_index_count=0, "inventory_indexes"', conf)
        self.assertIn('failed_stage=coalesce(active_logged_failed_stage, gap_failed_stage)', conf)
        self.assertIn('status=case(isnotnull(active_logged_failed_stage), "failed", isnotnull(gap_failed_stage), "degraded", true(), status)', conf)
        self.assertIn('metadata_sourcetype_count>0 AND metadata_source_count=0, "inventory_sources"', conf)
        self.assertIn('metadata_sourcetype_count>0 AND metadata_host_count=0, "inventory_hosts"', conf)
        self.assertIn('metadata_sourcetype_count>0 AND rest_data_model_count=0, "inventory_cim"', conf)
        self.assertIn('metadata_sourcetype_count>0 AND field_sampled_count=0, "inventory_fields"', conf)
        self.assertIn('search NOT (scan_run_id="inventory_snapshot_latest" AND origin="metadata_sourcetype")', conf)
        self.assertIn('search scan_run_id="inventory_snapshot_latest" origin="metadata_sourcetype" | eval _slice_source="prior"', conf)
        self.assertIn('eval _slice_priority=case(_slice_source="current", 2, _slice_source="prior", 1, true(), 0), _preserve_scope=if(_slice_priority>0, coalesce(dataset_key, _key), _key)', conf)
        self.assertIn('sort 0 _preserve_scope - _slice_priority', conf)
        self.assertIn('dedup _preserve_scope', conf)
        self.assertIn('eval snapshot_source=_slice_source', conf)
        self.assertIn('fields - _slice_priority _preserve_scope _slice_source', conf)
        self.assertIn(
            'search = | inputlookup muc_discovered_datasets | search NOT (scan_run_id="inventory_snapshot_latest" AND origin="metadata_sourcetype")',
            conf,
        )
        self.assertIn('search origin=metadata_sourcetype scan_run_id="inventory_snapshot_latest" snapshot_source="current"', conf)
        self.assertIn(
            'search = | inputlookup muc_scan_runs | search NOT scan_run_id=inventory_snapshot_latest',
            conf,
        )
        self.assertIn('search NOT (scan_run_id="inventory_snapshot_latest" AND origin="rest_data_model")', conf)
        self.assertIn('search scan_run_id="inventory_snapshot_latest" snapshot_source="current" | stats count(eval(origin="metadata_index")) as metadata_index_count', conf)
        self.assertIn('search scan_run_id="inventory_snapshot_latest" snapshot_source="current" | stats count as datasets_discovered', conf)
        self.assertIn('datasets_discovered=if(isnotnull(failed_stage), coalesce(prior_datasets_discovered, datasets_discovered_current), datasets_discovered_current)', conf)
        self.assertIn('gap_error_message=case(failed_stage="inventory_telemetry", "Stage telemetry produced no records; preserving prior successful snapshot summary where available."', conf)
        self.assertIn('error_summary=coalesce(active_logged_error_message, gap_error_message)', conf)
        self.assertIn('failed_stage="inventory_sourcetypes", "Sourcetype inventory produced no records after index inventory; preserving prior successful snapshot summary where available."', conf)
        self.assertIn('gap_error_details=if(isnotnull(gap_failed_stage), printf("{\\"kind\\":\\"gap\\",\\"stage\\":\\"%s\\",\\"message\\":\\"%s\\"', conf)
        self.assertIn('failure_record_json=case(isnotnull(active_logged_failed_stage), active_logged_error_details, isnotnull(gap_failed_stage), gap_error_details, true(), "null")', conf)
        self.assertIn('summary_json=printf("{\\"datasets_discovered\\":', conf)
        self.assertIn('\\"observed_datasets_discovered\\":%s', conf)
        self.assertIn('\\"telemetry_stage_count\\":%s', conf)
        self.assertIn('\\"metadata_index_count\\":%s', conf)
        self.assertIn('\\"metadata_source_count\\":%s', conf)
        self.assertIn('\\"metadata_host_count\\":%s', conf)
        self.assertIn('\\"rest_data_model_count\\":%s', conf)
        self.assertIn('\\"error_record\\":%s', conf)
        self.assertIn('failure_record_json, if(isnotnull(failed_stage), "true", "false"))', conf)
        self.assertIn("/services/data/models", conf)
        self.assertIn("outputlookup muc_discovered_datasets append=false", conf)
        self.assertIn("outputlookup muc_scan_runs append=false", conf)

    def test_transforms_conf_registers_discovery_kv_collections(self) -> None:
        conf = _transforms_conf()

        self.assertIn("[muc_discovered_datasets]", conf)
        self.assertIn("collection = muc_discovered_datasets", conf)
        self.assertIn("fields_list = _key, dataset_id, scan_run_id, dataset_key, display_name, origin, snapshot_source, last_seen, confidence", conf)
        self.assertIn("[muc_scan_runs]", conf)
        self.assertIn("collection = muc_scan_runs", conf)
        self.assertIn("fields_list = _key, scan_run_id, status, mode, started_at, completed_at, failed_stage, summary_json, datasets_discovered", conf)
        self.assertIn("[muc_scan_logs]", conf)
        self.assertIn("external_type = kvstore", conf)

    def test_copy_path_skips_macos_metadata(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            src = root / "src"
            dst = root / "dst"
            (src / "docs").mkdir(parents=True)
            (src / "docs" / ".DS_Store").write_text("ignore me", encoding="utf-8")
            (src / "docs" / "guide.md").write_text("keep me", encoding="utf-8")

            _copy_path(src, dst)

            self.assertTrue((dst / "docs" / "guide.md").exists())
            self.assertFalse((dst / "docs" / ".DS_Store").exists())

    def test_copy_site_subset_preserves_api_tree(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            site = root / "site"
            static = root / "static"
            (site / "api" / "v1" / "compliance").mkdir(parents=True)
            (site / "docs").mkdir(parents=True)
            (site / "api" / "v1" / "manifest.json").write_text("{}", encoding="utf-8")
            (site / "api" / "v1" / "compliance" / "gaps.json").write_text("{}", encoding="utf-8")
            (site / "docs" / "guide.md").write_text("guide", encoding="utf-8")
            (site / "index.html").write_text("<html></html>", encoding="utf-8")

            _copy_site_subset(site, static)

            self.assertTrue((static / "api" / "v1" / "manifest.json").exists())
            self.assertTrue((static / "api" / "v1" / "compliance" / "gaps.json").exists())
            self.assertTrue((static / "docs" / "guide.md").exists())

    def test_app_conf_uses_generated_build_timestamp(self) -> None:
        conf = _app_conf(
            BuildMetadata(
                version="7.1.0",
                generated_at="2026-04-22T16:47:12Z",
                git_sha="deadbeef",
                use_case_count=6472,
            )
        )

        self.assertIn("build = 20260422164712", conf)
        self.assertIn("version = 7.1.0", conf)


if __name__ == "__main__":
    unittest.main()