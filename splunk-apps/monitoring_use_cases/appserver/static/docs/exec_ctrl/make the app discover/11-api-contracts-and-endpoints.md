# API Contracts and Endpoints

## Goal
Define a clean internal API surface for frontend to backend communication.

## Endpoints

### POST /discovery/run
Start a discovery scan.

Request:
```json
{
  "mode": "standard"
}
```

Response:
```json
{
  "scan_run_id": "scan_20260421_001",
  "status": "running"
}
```

### GET /discovery/status/{scan_run_id}
Return current scan status.

### GET /discovery/summary/latest
Return latest successful scan summary.

Response:
```json
{
  "scan_run_id": "scan_20260421_001",
  "completed_at": "2026-04-21T18:00:00Z",
  "datasets_discovered": 148,
  "use_cases_direct": 412,
  "use_cases_adjacent": 803,
  "use_cases_partial": 661,
  "use_cases_none": 4574
}
```

### GET /datasets
Return paginated discovered dataset library.

### GET /datasets/{dataset_id}
Return dataset detail and related use cases.

### GET /use-cases/{use_case_id}/mapping
Return effective mapping detail for a single use case.

Response:
```json
{
  "use_case_id": "UC-000123",
  "engine_state": "adjacent",
  "effective_state": "admin_asserted",
  "matched_dataset_ids": ["ds_017"],
  "evidence": [],
  "missing_requirements": [],
  "override": {
    "active": true,
    "type": "assert_direct",
    "note": "Local sourcetype naming differs but dataset is valid"
  }
}
```

### GET /mappings
Return mapping results with filters.

Query examples:
- `?effective_state=direct`
- `?effective_state=adjacent&domain=network`
- `?latest_only=true`

### POST /overrides
Create an admin override.

Request:
```json
{
  "use_case_id": "UC-000123",
  "dataset_id": "ds_017",
  "override_type": "assert_direct",
  "note": "Validated against local schema"
}
```

### DELETE /overrides/{override_id}
Disable or remove override.

### GET /scan-runs
Return scan history.

### GET /scan-runs/{scan_run_id}
Return scan detail, summary, and stage telemetry.

## API principles
- stable response shapes
- paginated large collections
- explicit error states
- no destructive side effects in read routes
- admin authorization on mutation routes
