# Admin Refinement Workbench

## Purpose
Provide a controlled interface for admins to govern mapping outcomes.

## Why this exists
No deterministic engine will be perfect across every customer environment.

Admins need a native, persistent way to:
- correct false positives
- elevate valid adjacent matches
- attach local knowledge
- define explicit mappings
- suppress bad candidates

## Workbench sections

### 1. Suggested mappings queue
Show engine-generated suggestions sorted by review priority.

Priority signals:
- high-scoring adjacent matches
- partial matches close to direct
- high-value use cases still unresolved
- recently changed results compared to prior scan

### 2. Explicit mapping editor
Allow admin to bind:
- one dataset to one use case
- one dataset to multiple use cases
- multiple datasets to one use case

### 3. Rejection / suppression editor
Allow rejection of:
- a specific mapping candidate
- a dataset for one use case
- a dataset family globally if it is misleading noise

### 4. Adjacency tuning
Admins can define local equivalence or adjacency where their environment uses local naming or custom normalization.

### 5. Notes and rationale
Every manual action should support notes.

## Override types
- confirm_direct
- assert_direct
- assert_adjacent
- reject_mapping
- suppress_dataset
- define_local_alias
- define_local_family

## Precedence model
Effective state order:
1. reject / suppress
2. explicit admin assertion
3. engine output

## Governance rules
- require admin capability for any change
- preserve engine result underneath override
- log all changes
- support disable / re-enable of overrides
- support viewing only manual changes

## Safe defaults
- manual changes do not alter catalog source content
- manual changes only affect local mapping layer
- rerunning discovery does not erase overrides

## Useful admin views
- most valuable unsupported use cases
- most noisy datasets
- most overridden mappings
- mappings changed by latest rules version
