---
title: Example Ledger Data Model
abbrev: Example Ledger Data Model
keywords: ledger, data model, example
---

# Abstract

This document defines the fictional data model that the Example Ledger
Interchange Format serialises. It is deliberately long and deeply structured so
that this installation always has a document that exercises deep heading trees,
large tables of contents and multi-page rendering.

# Introduction

The model has three layers: entities, movements and controls. Each layer is
specified in its own section, and each section is subdivided far enough to
produce a realistic table of contents.

## Scope

This document specifies the abstract model only. Serialisation is specified in
[EXAMPLE-FORMAT].

## Notation

Field names appear in `code style`. Cardinalities are written as `0..1`,
`1..1`, `0..n` and `1..n`.

# Entities

## Account

### Identity

An account is identified by an opaque `account-id` of 4 to 24 characters.
Identifiers MUST be compared byte for byte; no case folding or normalisation is
applied.

#### Uniqueness

An `account-id` MUST be unique inside one ledger. Reuse of a retired identifier
is NOT RECOMMENDED because it breaks historical reconciliation.

#### Lifecycle

An account is `open`, `frozen` or `closed`. Only an `open` account MAY receive
movements.

### Attributes

| Attribute     | Cardinality | Type     | Notes                            |
|---------------|-------------|----------|----------------------------------|
| account-id    | 1..1        | string   | Opaque identifier                |
| display-name  | 0..1        | string   | Free text, never used for lookup |
| currency      | 1..1        | string   | Uppercase alphabetic code        |
| state         | 1..1        | enum     | open, frozen or closed           |

### Constraints

An account MUST NOT change its `currency` after the first movement is posted.
Implementations MUST reject such a change rather than migrating balances
implicitly.

## Counterparty

### Identity

A counterparty is identified by `counterparty-id`. Counterparties are not
accounts and MUST NOT be used in the `account` field of a movement.

### Attributes

| Attribute        | Cardinality | Type   |
|------------------|-------------|--------|
| counterparty-id  | 1..1        | string |
| jurisdiction     | 0..1        | string |

# Movements

## Posting Rules

A movement is a signed amount applied to exactly one account. Double-entry
pairing is out of scope for this model and is handled by the control layer.

### Ordering

Movements are totally ordered inside a batch and partially ordered across
batches. Implementations MUST NOT reorder movements inside a batch.

### Idempotency

A movement carries a `movement-id`. Re-posting a movement with an identical
`movement-id` and identical fields MUST be treated as a no-op. Re-posting with
the same identifier but different fields MUST be rejected.

## Amount Representation

Amounts are exact decimals with two fractional digits. The following ABNF
describes the canonical textual form:

```abnf
amount = ["-"] 1*12DIGIT "." 2DIGIT
```

### Rounding

No rounding is defined by this model. A producer that cannot represent a value
exactly MUST fail rather than round.

### Overflow

Values outside the representable range MUST be rejected with a diagnostic that
names the offending `movement-id`.

# Controls

## Batch Control Total

Each batch carries a control total equal to the exact sum of its movement
amounts.

### Verification

A receiver MUST recompute the control total and reject the batch on mismatch.

### Reporting

The diagnostic emitted on mismatch MUST include the expected value, the computed
value and the batch identifier.

## Reconciliation Windows

### Daily Window

The daily window closes at a deployment-defined instant. Movements posted after
the close belong to the next window.

### Correction Window

Corrections MAY be posted into a closed window for a deployment-defined grace
period. After the grace period, a compensating movement MUST be used instead.

# Security Considerations

The model carries no authentication. Deployments MUST authenticate producers
before accepting batches, and MUST log the authenticated producer identity with
every accepted batch.

Opaque identifiers are frequently derived from customer data in practice.
Implementations SHOULD treat `account-id` and `counterparty-id` as personal data
for retention and access-control purposes.

# Operational Considerations

Long reconciliation windows increase memory usage linearly with movement volume.
Operators SHOULD size the correction window against observed correction rates
rather than a fixed default.

# Normative References

[EXAMPLE-FORMAT]  Example Standards Organization, "Example Ledger Interchange Format", TEST-STD-0001, August 2026.

# Appendix A: Field Summary

| Layer     | Field           | Required |
|-----------|-----------------|----------|
| Entity    | account-id      | yes      |
| Entity    | currency        | yes      |
| Movement  | movement-id     | yes      |
| Movement  | amount          | yes      |
| Control   | control-total   | yes      |

# Appendix B: Worked Reconciliation

A batch with three movements of `10.00`, `-4.50` and `0.25` has a control total
of `5.75`. A receiver computing `5.74` MUST reject the batch and report both
values together with the batch identifier.
