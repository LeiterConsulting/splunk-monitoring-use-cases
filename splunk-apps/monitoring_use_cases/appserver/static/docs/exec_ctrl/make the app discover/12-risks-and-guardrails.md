# Risks and Guardrails

## Risk 1. False confidence
If the engine presents weak adjacency as certainty, admins will distrust it.

Guardrail:
- separate direct vs adjacent clearly
- always show evidence and gaps
- never hide admin overrides

## Risk 2. Overly expensive scans
Deep discovery in large environments can become slow or disruptive.

Guardrail:
- offer quick, standard, deep modes
- use bounds, sampling, and pagination
- preserve prior results if a run fails

## Risk 3. Mapping drift across releases
Rule changes can cause confusing result changes over time.

Guardrail:
- version the rulepack
- preserve scan history
- expose diffs across runs

## Risk 4. Noisy custom data
Custom sourcetypes may create bad suggestions.

Guardrail:
- allow suppression
- require explicit adjacency registry
- give admins refinement controls

## Risk 5. Fragile one-shot agent implementation
Trying to build the entire feature in one giant agent prompt will likely create inconsistent code.

Guardrail:
- use exec-ctrl with bounded slices
- require tests and verification per slice
- package and validate repeatedly

## Risk 6. Runtime dependence on agent logic
If runtime execution requires open-ended agent reasoning, the feature becomes difficult to trust and support.

Guardrail:
- runtime logic must be deterministic
- agentic systems are limited to development-time delivery and rulepack generation

## Risk 7. Governance ambiguity
If admin changes are not clearly represented, supportability and auditability suffer.

Guardrail:
- preserve engine state and admin state separately
- log changes with actor and timestamp

## Risk 8. Native UX mismatch
If the feature feels like an external tool jammed into the app, adoption will suffer.

Guardrail:
- integrate actions into existing catalog surfaces
- use Splunk-native interaction patterns
- keep terminology consistent and operational
