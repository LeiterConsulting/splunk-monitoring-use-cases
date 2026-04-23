# Runtime Design

## Runtime goal
Provide a safe, deterministic, Splunk-local workflow for discovering available data assets and mapping them to use cases in the app.

## Runtime pipeline

### Stage 1. Discovery run requested
The admin clicks `Run Environment Discovery`.

The app creates a `scan_run` record with:
- run id
- start timestamp
- user
- app version
- rules version
- status = queued or running
- scan scope options

### Stage 2. Discovery scanner executes
The scanner gathers a bounded inventory.

Recommended discovery sources:
- REST endpoints for indexes and data models
- metadata search for sourcetypes, sources, and hosts
- summary searches for field prevalence
- CIM tag and eventtype inspection
- installed app / TA inspection where allowed

The scanner must enforce timeouts and size caps.

### Stage 3. Inventory normalization
Normalize raw observations into canonical dataset candidates.

Example normalized record:
- dataset id
- canonical name
- source family
- sourcetypes
- indexes
- observed fields
- tags
- datamodels
- supporting evidence
- discovery strength

### Stage 4. Mapping evaluation
For each use case requirement profile:
- test exact requirements
- test adjacent requirements
- test partial coverage
- produce mapping record
- attach rationale

### Stage 5. Persistence
Write results to persistent storage:
- discovered datasets
- use case mapping results
- scan evidence
- scan summary
- unresolved candidates

### Stage 6. Catalog refresh
The UI refreshes filters and badges from persisted state.

### Stage 7. Admin refinement
Optional follow-on flow:
- confirm
- reject
- override
- create manual mapping

## Discovery scope modes

### Quick scan
Fast inventory only.
Good for large environments and first-run experiences.

### Standard scan
Includes field prevalence and CIM clues.
Recommended default.

### Deep scan
Includes broader schema sampling and optional validation probes.
Use carefully and only for admins.

## Runtime performance controls
- query time bounds
- maximum sourcetype count per pass
- maximum sampled events per sourcetype
- pagination for large environments
- pause/cancel support if feasible

## Runtime output classes

### Dataset discovery output
What data seems to exist.

### Mapping output
Which use cases appear supported.

### Gap output
What is missing or weak.

### Governance output
What an admin changed relative to the engine output.

## Explainability requirement
Every mapping must include:
- mapping state
- deterministic reasons
- matched evidence
- missing evidence
- rule version
- whether an admin changed the result

## Failure handling
Discovery failures must be non-destructive.

A failed run should:
- preserve prior successful results
- mark the new run as failed
- capture the stage of failure
- capture a sanitized error record
- never silently overwrite good prior data with empty state
