---
title: Example Ledger Notification Protocol
abbrev: Example Notification Protocol
keywords: ledger, notification, draft
---

# Abstract

This working draft describes a fictional notification protocol that informs
subscribers when a ledger batch is accepted. It is used to exercise the review,
change-request and approval flow of this installation.

# Introduction

Subscribers currently poll for batch state, which is both slow and expensive.
This document defines a push notification instead. The message format appears in
{{section-3}} and the delivery guarantees in {{section-4}}.

# Message Format

A notification is a single line:

```abnf
notification = "ELIF-NOTIFY" SP batch-id SP outcome CRLF
outcome      = "accepted" / "rejected"
```

The `batch-id` MUST match the identifier carried in the batch header defined by
[EXAMPLE-FORMAT].

# Delivery Guarantees

Delivery is at-least-once. Subscribers MUST therefore treat notifications as
idempotent and MUST key deduplication on `batch-id`.

A publisher SHOULD retry a failed delivery with exponential backoff, and MUST
stop retrying after a deployment-defined attempt limit.

# Security Considerations

Notifications reveal batch identifiers and acceptance outcomes. A publisher MUST
authenticate subscribers before delivering notifications, and MUST NOT include
account identifiers or amounts in a notification.

Because delivery is at-least-once, an attacker who can replay notifications can
cause repeated processing. Subscribers MUST deduplicate on `batch-id` as
described in Section 4.

# Operational Considerations

Operators SHOULD alert on sustained retry rates: they usually indicate a
subscriber outage rather than a publisher defect.

# Normative References

[EXAMPLE-FORMAT]  Example Standards Organization, "Example Ledger Interchange Format", TEST-STD-0001, August 2026.

# Appendix A: Worked Example

A batch accepted by the receiver produces:

```
ELIF-NOTIFY BATCH-000241 accepted
```
