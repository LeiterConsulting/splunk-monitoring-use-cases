from __future__ import annotations

import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from discovery_requirements import build_discovery_requirement_payload


class DiscoveryRequirementProfilesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.payload = build_discovery_requirement_payload(
            REPO_ROOT,
            generated_at="2026-04-22T00:00:00Z",
            catalog_version="test-version",
        )
        cls.profile_map = {
            profile["use_case_id"]: profile
            for profile in cls.payload["profiles"]
        }

    def test_payload_covers_catalog_tree_and_tracks_fallbacks(self) -> None:
        self.assertEqual(self.payload["profileCount"], len(self.payload["profiles"]))
        self.assertEqual(
            self.payload["catalogFallbackCount"],
            len(self.payload["missingSidecarUseCases"]),
        )
        self.assertGreater(self.payload["profileCount"], 6400)
        self.assertGreaterEqual(self.payload["catalogFallbackCount"], 1)

        first_missing = self.payload["missingSidecarUseCases"][0]
        self.assertEqual(
            self.profile_map[first_missing]["normalization_hints"]["source_kind"],
            "catalog_compact",
        )

    def test_sidecar_profile_extracts_expected_search_hints(self) -> None:
        profile = self.profile_map["UC-1.1.1"]
        hints = profile["normalization_hints"]
        requirements = profile["requirements"]

        self.assertEqual(hints["source_kind"], "sidecar")
        self.assertIn("os", hints["indexes"])
        self.assertIn("cpu", hints["sourcetypes"])
        self.assertIn("Performance", hints["datamodels"])
        self.assertIn("Splunk_TA_nix", requirements["app_candidates"])
        self.assertIn("Performance", requirements["cim_models"])


if __name__ == "__main__":
    unittest.main()