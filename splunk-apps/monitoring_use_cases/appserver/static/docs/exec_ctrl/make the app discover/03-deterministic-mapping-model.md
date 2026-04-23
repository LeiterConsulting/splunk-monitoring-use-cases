# Deterministic Mapping Model

## Objective
Define a deterministic model that maps environment findings to catalog use cases.

## Use case requirement profile
Every use case should be normalized into a requirement object.

Suggested shape:

```json
{
  "use_case_id": "UC-000123",
  "title": "Detect router interface saturation",
  "domain": "network",
  "required": {
    "datasource_families": ["network_device_metrics"],
    "sourcetypes": ["snmp:interfaces", "stream:netflow"],
    "fields": ["host", "interface", "in_bps", "out_bps"],
    "cim_tags": ["network", "performance"]
  },
  "adjacent": {
    "datasource_families": ["network_telemetry", "custom_network_metrics"],
    "fields": ["bandwidth", "ifName", "utilization"]
  },
  "validation": {
    "min_field_coverage": 0.65,
    "min_evidence_items": 2
  },
  "disqualifiers": {
    "missing_all_fields": ["host", "interface"]
  }
}
```

## Mapping states

### direct
Strong evidence that required data exists in a way that directly supports the use case.

### adjacent
A close or semantically compatible dataset exists, but may need adaptation, field mapping, or normalization.

### partial
Some required evidence exists, but coverage is insufficient.

### none
No meaningful evidence was found.

### admin_asserted
An admin explicitly created or confirmed a mapping.

### admin_rejected
An admin explicitly rejected a proposed mapping.

## Deterministic evidence model
Evidence sources may include:
- exact sourcetype match
- exact or accepted index match
- required field presence threshold
- CIM tag presence
- data model presence
- TA presence
- known source family equivalence

Each evidence item should be typed, for example:

```json
{
  "evidence_type": "exact_sourcetype",
  "value": "snmp:interfaces",
  "strength": "strong",
  "source": "metadata",
  "observed_in": ["netops", "infra"]
}
```

## Rule evaluation order
1. explicit admin override
2. exact requirement tests
3. accepted equivalent tests
4. adjacency tests
5. partial coverage tests
6. none

## Example scoring approach
The implementation can use numeric scoring internally, but the output must remain deterministic and explainable.

Example weighted signals:
- exact sourcetype match = 40
- matching datasource family = 25
- CIM alignment = 20
- field coverage threshold met = 25
- installed TA clue = 10
- admin prior confirmation boost = 100, if explicit

Map scores into states only after deterministic rule gates are applied.

## Adjacency model
Adjacency must be defined by explicit rulepack, not by freeform inference.

Examples:
- vendor-specific firewall logs adjacent to generic firewall monitoring use cases
- custom metrics adjacent to infrastructure monitoring metrics if field aliases are known
- alternate network telemetry sources adjacent to SNMP-derived requirements where core signals align

## Rulepack versioning
The engine must expose:
- rulepack version
- requirement schema version
- adjacency registry version

This ensures reruns are comparable across releases.

## Admin override precedence
Admin actions override engine display state, but the underlying engine result must remain stored for auditability.

Example:
- engine says `adjacent`
- admin says `direct`
- UI shows `admin_asserted`
- library preserves original `adjacent` result and supporting evidence
