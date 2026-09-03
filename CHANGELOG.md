# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While the major version is 0, the public interfaces described below may change
in a minor release. Database migrations are always forward-only and are applied
on boot.

## [Unreleased]

## [0.1.0] - 2026-08-23

First public release.

### Added

- **Reader.** Full-viewport, fixed-width, paginated reading surface with a
  metadata panel (Info, Contents, Prefs), light, dark and automatic themes, a
  7pt to 16pt font control, and working section, page, citation and
  cross-document links.
- **Draft workspace.** In-browser Markdown and RFCXML authoring with live
  preview from the publishing renderer, an outline, validation diagnostics,
  autosave, conflict-safe concurrent editing and immutable revision snapshots.
- **Review.** Review rounds pinned to an immutable revision, anchored comment
  threads, blocking change requests, and thread carry-forward between revisions.
- **Approval and publication.** Configurable approval gates, approvals bound to
  a revision checksum so a source change makes them stale, and a single atomic
  publish transaction that allocates the number, locks the snapshot, generates
  every artifact and only then flips the document to published.
- **Corrections.** Published revisions are immutable. Corrections go through
  errata, and changes go through a new `updates` or `obsoletes` document.
- **Provenance.** A lifecycle timeline, a searchable append-only audit history,
  reference graphs in both directions, and notification recipient expansion that
  explains who would be notified and why.
- **People, teams and access.** Role-based access control, team membership,
  administrator-issued passwords, and single-use invite and reset links whose
  tokens are stored only as hashes.
- **Installation settings.** Brand name, organization name and bug report URL
  are editable from Admin > Settings. An environment variable that is explicitly
  set still wins and the field is shown as managed, so neither an operator's
  configuration nor an administrator's edit can be silently ignored.
- **Artifacts.** Plaintext, HTML, PDF and BibTeX rendering, with local or S3
  compatible artifact storage.
- **Optional external import.** A disabled-by-default adapter can import
  external documents as read-only references. The application is fully
  functional with no internet connection.
- **Deployment.** Docker Compose stack with database, migrations, web and
  worker. Health endpoints for liveness and readiness.

### Notes

- Text outside WinAnsi is carried by a generated `/Differences` encoding, so
  Turkish and the rest of Latin Extended-A render in PDFs without an embedded
  font. A character with no available glyph is reported rather than replaced
  silently.
- Rate limiting, outgoing mail signing and Content Security Policy headers are
  deliberately left to the reverse proxy. See [SECURITY.md](SECURITY.md).

[Unreleased]: https://github.com/bkoroglu1/draftledger/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bkoroglu1/draftledger/releases/tag/v0.1.0
