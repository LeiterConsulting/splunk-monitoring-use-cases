# Data Model and Storage

## Persistence strategy
Use Splunk app-native persistent storage, preferably KV Store collections, with optional lookup export for portability.

## Collections

### 1. use_case_requirements
Stores normalized requirement profiles derived from the catalog.

Suggested fields:
- _key
- use_case_id
- title
- domain
- profile_json
- schema_version
- source_catalog_version
- updated_at

### 2. discovered_datasets
Stores normalized dataset candidates discovered from the local environment.

Suggested fields:
- _key
- scan_run_id
- dataset_id
- canonical_name
- source_family
- sourcetypes
- indexes
- sources
- hosts
- fields
- field_stats
- tags
- datamodels
- supporting_apps
- evidence_json
- discovery_strength
- created_at

### 3. use_case_mappings
Stores engine-produced mapping results.

Suggested fields:
- _key
- scan_run_id
- use_case_id
- engine_state
- effective_state
- score
- matched_dataset_ids
- evidence_json
- missing_requirements_json
- rulepack_version
- created_at

### 4. mapping_overrides
Stores admin-created decisions.

Suggested fields:
- _key
- use_case_id
- dataset_id
- override_type
- asserted_state
- notes
- created_by
- created_at
- active

### 5. scan_runs
Stores scan metadata and lifecycle state.

Suggested fields:
- _key
- scan_run_id
- requested_by
- mode
- status
- started_at
- completed_at
- failed_stage
- summary_json
- app_version
- rules_version

### 6. scan_logs
Optional fine-grained scan telemetry.

Suggested fields:
- _key
- scan_run_id
- stage
- level
- message
- details_json
- timestamp

### 7. adjacency_registry
Stores accepted adjacency definitions.

Suggested fields:
- _key
- family_a
- family_b
- relationship_type
- rationale
- active
- version

## Exportability
Provide optional export of:
- latest scan summary
- mapping results
- admin overrides
- unresolved use cases

Formats:
- JSON first
- CSV optional for reporting

## Data retention
Recommended defaults:
- keep last N scan runs
- keep override history indefinitely unless purged by admin
- compress or summarize verbose evidence after a threshold

## Auditability
All manual changes should capture:
- actor
- timestamp
- old state
- new state
- note or rationale

## Upgrade safety
When schemas evolve:
- preserve old records
- run migration scripts
- never hard-delete on upgrade unless explicitly requested
