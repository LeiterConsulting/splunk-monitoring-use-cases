# Agent Task Graph

## Objective
Provide a bounded task graph that an IDE agent can execute incrementally.

## Phase 0. Inventory the current app

### Task 0.1
Inspect the current native Splunk app structure.
Deliver:
- file tree summary
- frontend framework summary
- backend endpoint summary
- existing catalog data loading path
- storage model summary

### Task 0.2
Identify integration points for discovery, mapping, and results pages.
Deliver:
- recommended insertion points
- risks
- required migrations

## Phase 1. Schemas and storage

### Task 1.1
Create schema definitions for:
- use case requirements
- discovered datasets
- use case mappings
- mapping overrides
- scan runs

### Task 1.2
Implement KV store or app storage definitions.

### Task 1.3
Add migrations and bootstrap routines.

## Phase 2. Requirement normalization

### Task 2.1
Create a transformer from current catalog content into normalized requirement profiles.

### Task 2.2
Persist requirement profiles for runtime use.

### Task 2.3
Create validation tests for profile generation.

## Phase 3. Discovery engine

### Task 3.1
Implement metadata inventory of indexes, sourcetypes, sources, and hosts.

### Task 3.2
Implement CIM and data model inspection.

### Task 3.3
Implement field prevalence sampler.

### Task 3.4
Normalize raw findings into discovered dataset records.

### Task 3.5
Add bounded runtime controls and failure handling.

## Phase 4. Mapping engine

### Task 4.1
Implement rule evaluator for direct matches.

### Task 4.2
Implement adjacency evaluator.

### Task 4.3
Implement partial match evaluator.

### Task 4.4
Implement precedence and effective state logic.

### Task 4.5
Write evidence serialization and explainability strings.

## Phase 5. APIs and orchestration

### Task 5.1
Create endpoint to start scan.

### Task 5.2
Create endpoint to fetch latest summary.

### Task 5.3
Create endpoint to fetch mappings by use case.

### Task 5.4
Create endpoint to fetch dataset library.

### Task 5.5
Create endpoints for overrides and admin actions.

## Phase 6. UX integration

### Task 6.1
Add discovery action to catalog header.

### Task 6.2
Add filters and badges.

### Task 6.3
Add use case evidence drawer.

### Task 6.4
Add results library page.

### Task 6.5
Add admin workbench.

## Phase 7. Verification

### Task 7.1
Create unit tests.

### Task 7.2
Create integration tests.

### Task 7.3
Create fixture-based synthetic environments.

### Task 7.4
Validate package/install path.

## Phase 8. Documentation

### Task 8.1
Create operator documentation.

### Task 8.2
Create admin refinement documentation.

### Task 8.3
Create release notes and upgrade notes.
