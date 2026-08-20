---
title: Example Ledger Interchange Format
abbrev: Example Ledger Format
keywords: ledger, interchange, example
---

# Abstract

This document defines a small, entirely fictional interchange format for ledger
records. It exists so that this installation has a realistic published standard
to read, cite, compare and correct. It MUST NOT be treated as a real standard of
any organization.

# Introduction

Systems that exchange ledger records need a shared, unambiguous encoding. This
document specifies such an encoding, called the Example Ledger Interchange
Format (ELIF). The grammar appears in {{section-3.1}}; conformance rules appear
in {{section-4}}.

The model this format serialises is described in [EXAMPLE-MODEL].

# Terminology

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY and OPTIONAL in this document are to be interpreted as
requirement levels for implementations of this specification.

Record:
: A single line of interchange data describing one ledger movement.

Batch:
: An ordered sequence of records sharing one header.

# Format Definition

An ELIF stream is a sequence of UTF-8 encoded lines. Each line is either a
header line or a record line. Implementations MUST reject streams that mix
encodings.

## Grammar

The grammar is expressed in ABNF:

```abnf
stream      = header 1*record
header      = "ELIF" SP version SP batch-id CRLF
version     = 1*2DIGIT "." 1*2DIGIT
batch-id    = 8*32(ALPHA / DIGIT / "-")
record      = account SP amount SP currency SP description CRLF
account     = 4*24(ALPHA / DIGIT / "-")
amount      = ["-"] 1*12DIGIT "." 2DIGIT
currency    = 3ALPHA
description = 1*160(VCHAR / SP)
```

## Field Semantics

| Field       | Width | Required | Notes                                    |
|-------------|------:|----------|------------------------------------------|
| account     |    24 | yes      | Opaque identifier, compared byte for byte |
| amount      |    15 | yes      | Signed decimal with exactly two decimals  |
| currency    |     3 | yes      | Uppercase alphabetic code                 |
| description |   160 | no       | Free text, MUST NOT contain CR or LF       |

Implementations MUST preserve the byte order of records inside a batch. A
receiver SHOULD reject a batch whose amounts do not sum to the control total
carried out of band.

## Example Stream

```
ELIF 1.0 BATCH-000241
ACC-000001 0000000100.00 EUR opening balance
ACC-000002 -000000025.50 EUR settlement fee
```

# Conformance

An implementation conforms to this document when it satisfies all of the
following:

1. It parses every stream that matches the grammar in Section 3.1.
2. It rejects, with a diagnostic, every stream that does not.
3. It preserves record order within a batch.
4. It reports the batch identifier in every diagnostic it emits.

::: note Implementation note
Partial conformance is not defined by this document. A processor that accepts
malformed streams is not conforming, even if it produces plausible output.
:::

# Security Considerations

The format carries no authentication or integrity protection of its own.
Deployments MUST apply transport-level integrity protection, and SHOULD apply
authentication of the sending party, before treating a batch as authoritative.

Description fields are attacker-controlled free text. Implementations MUST NOT
interpret them as markup, shell input or file paths, and SHOULD bound their
length as specified in Section 3.2.

Amount parsing is a common source of defects. Implementations MUST use exact
decimal arithmetic; binary floating point MUST NOT be used for amounts.

# Operational Considerations

Operators SHOULD monitor rejected batch counts. A sustained increase usually
indicates a version mismatch between sender and receiver rather than data
corruption. Migration guidance is given in {{appendix-a}}.

# Normative References

[EXAMPLE-MODEL]  Example Standards Organization, "Example Ledger Data Model", TEST-STD-0002, August 2026.

# Informative References

[EXAMPLE-OPS]  Example Standards Organization, "Operating Example Ledger Deployments", <https://example.invalid/ops-guide>.

# Appendix A: Migration Guidance

Deployments migrating from an ad-hoc CSV export should map columns as follows:

- The first CSV column becomes `account`.
- The amount column MUST be reformatted to exactly two decimals.
- Any column not listed above is dropped; ELIF has no extension mechanism in
  this version.

# Appendix B: Worked Rejection Example

The following stream is invalid because the amount has one decimal digit:

```
ELIF 1.0 BATCH-000242
ACC-000001 0000000100.0 EUR opening balance
```

A conforming processor rejects the whole batch and reports `BATCH-000242`.
