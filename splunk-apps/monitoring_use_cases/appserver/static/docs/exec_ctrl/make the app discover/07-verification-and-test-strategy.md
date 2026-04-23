# Verification and Test Strategy

## Goal
Verify the feature deterministically across multiple environment conditions.

## Test layers

### 1. Schema validation
Validate:
- requirement objects
- dataset discovery objects
- mapping result objects
- override objects

### 2. Unit tests
Target:
- normalization logic
- evidence extraction
- rule evaluation
- precedence logic
- state transitions

### 3. Integration tests
Target:
- REST handlers
- KV store persistence
- scan lifecycle behavior
- catalog filter behavior

### 4. UI tests
Target:
- filter rendering
- badge rendering
- evidence drawer
- override workflows
- empty states

### 5. Environment simulation tests
Create synthetic scenarios:
- empty environment
- exact-match environment
- adjacent-only environment
- partial-field environment
- noisy custom sourcetype environment
- admin override persistence across rerun

## Golden scenarios
Define at least these canonical cases:

### Scenario A. No data
Expected:
- zero direct
- zero adjacent unless metadata suggests otherwise
- all use cases remain unsupported

### Scenario B. Clean CIM-aligned environment
Expected:
- high direct match rate for corresponding use cases
- low false positives

### Scenario C. Custom environment with local sourcetypes
Expected:
- adjacency results where aliases exist
- admin workbench required for promotion

### Scenario D. Override durability
Expected:
- rerun preserves admin assertions and rejections
- engine result is still viewable underneath

### Scenario E. Rules version change
Expected:
- diffs are visible
- historical scan comparison remains possible

## Verification outputs
For every build, capture:
- passed test counts
- failed test counts
- changed mapping counts in reference fixtures
- packaging result
- install validation result

## Non-functional checks
- query time bounded
- no destructive writes on failed scan
- no privilege escalation beyond declared app needs
- large environment behavior remains responsive
