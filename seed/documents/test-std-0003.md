---
title: Example Ledger Interchange Format, Version 1.1
abbrev: Example Ledger Format 1.1
keywords: ledger, interchange, example, update
---

# Abstract

This document updates the Example Ledger Interchange Format with an optional
extension field and clarified rejection behaviour. It is a fictional test
fixture used to exercise update relations in this installation.

# Introduction

This document updates [EXAMPLE-FORMAT-10]. Implementations of the earlier
version remain conforming for streams that do not use the extension field
defined in {{section-3}}.

# Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY in this document are to
be interpreted as requirement levels.

# Extension Field

A record MAY carry one trailing extension field:

```abnf
record      = account SP amount SP currency SP description [SP extension] CRLF
extension   = "x-" 1*32(ALPHA / DIGIT / "-") "=" 1*64(VCHAR)
```

A receiver that does not understand an extension MUST ignore it and MUST NOT
reject the record for its presence alone.

# Clarified Rejection Behaviour

Version 1.0 left it ambiguous whether a malformed record invalidates the record
or the batch. This document resolves the ambiguity: a malformed record
invalidates the entire batch.

# Security Considerations

Extension values are attacker-controlled. Implementations MUST bound extension
length as specified in Section 3 and MUST NOT interpret extension values as
executable input.

# Normative References

[EXAMPLE-FORMAT-10]  Example Standards Organization, "Example Ledger Interchange Format", TEST-STD-0001, August 2026.

# Appendix A: Compatibility Matrix

| Sender | Receiver | Extension present | Outcome  |
|--------|----------|-------------------|----------|
| 1.0    | 1.0      | no                | accepted |
| 1.1    | 1.0      | yes               | ignored  |
| 1.1    | 1.1      | yes               | accepted |
