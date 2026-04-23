# Implementation Backlog

## Epic 1. Discovery foundation

### Story 1.1
As an admin, I can launch an environment discovery scan with one click.

Acceptance:
- scan can be started from catalog UI
- scan run record is created
- status is visible

### Story 1.2
As an admin, I can see a summary of discovered datasets after a scan.

Acceptance:
- discovered dataset count shown
- major source families shown
- last successful run shown

## Epic 2. Deterministic mappings

### Story 2.1
As an admin, I can see which use cases have direct dataset matches.

Acceptance:
- direct badge appears
- details include evidence

### Story 2.2
As an admin, I can see adjacent matches separately from direct matches.

Acceptance:
- adjacent badge appears
- filter exists
- rationale visible

### Story 2.3
As an admin, I can see partial support and missing requirements.

Acceptance:
- partial badge appears
- missing fields / criteria shown

## Epic 3. Results library

### Story 3.1
As an admin, I can browse discovered datasets in a dedicated library.

### Story 3.2
As an admin, I can browse mapping results across all use cases.

### Story 3.3
As an admin, I can review prior scan runs.

## Epic 4. Admin governance

### Story 4.1
As an admin, I can confirm or reject a mapping.

### Story 4.2
As an admin, I can manually create an explicit mapping.

### Story 4.3
As an admin, I can define local aliases or adjacency rules.

### Story 4.4
As an admin, I can suppress noisy datasets from mapping suggestions.

## Epic 5. Explainability

### Story 5.1
As a user, I can see why a use case is considered supported.

### Story 5.2
As a user, I can distinguish engine-generated state from admin-defined state.

## Epic 6. Reliability

### Story 6.1
As an admin, failed scans do not erase prior good results.

### Story 6.2
As an admin, overrides persist across scan reruns.

### Story 6.3
As an admin, scan history remains auditable.

## Suggested priority order
P0:
- schema/storage
- discovery scan start
- discovery normalization
- direct mapping rules
- persisted summary

P1:
- adjacent / partial mapping
- catalog filters and badges
- results library

P2:
- admin override workbench
- local alias tuning
- advanced diffs and reporting
