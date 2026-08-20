# Security

## Threat model in one paragraph

DraftLedger holds unpublished standards, review discussions and approval
records. The interesting attacks are: reading a draft you should not see,
changing a document after it was approved, forging or erasing the record of who
decided what, and using the optional import adapter to make the server fetch
something it should not.

## Roles and authorization

Organization roles, in increasing privilege: `reader`, `author`, `editor`,
`reviewer`, `approver`, `publisher`, `admin`. Group roles are independent:
`owner`, `reviewer`, `approver`, `publisher`, `member`.

Every check lives in `src/services/rbac.ts` and is evaluated on the server.
Hiding a button is presentation, never enforcement — each server action and route
handler re-derives the ACL from the database before acting.

| Capability | Rule |
|---|---|
| Read | Visibility `public`: anyone. `organization`: any signed-in user. `group`: group members, authors, editors, owner. `private`: owner, authors, editors. Admin always. |
| Edit draft | Contributor with at least the `author` role, or group owner, or admin — and the document must not be published, superseded or historic, and must not be an external import. |
| Review | `reviewer` or above, or a group reviewer/approver. Reviewers cannot modify the source. |
| Approve | `approver` or above, or a group approver. Gates that name a group additionally require membership of it. |
| Publish | `publisher` or above, or a group publisher. |
| Manage policy | Admin only. |
| See delivery addresses | Admin, publisher, group owner or document owner. |

### Draft confidentiality

A document the viewer may not read is reported as `not_found`, not `forbidden`,
so the existence of a private draft is not disclosed. The same rule is applied in
SQL: `searchDocuments` filters visibility inside the query, so pagination counts
cannot be used to infer hidden documents. `/compare` resolves both revisions
through their parent documents and 404s if either is unreadable.

## Approval and publication integrity

- Approvals are bound to a revision checksum. Changing the source marks them
  stale, in the same transaction that creates the new revision.
- Gates are evaluated twice: when publication is requested, and again inside the
  publish transaction.
- Published revisions cannot be edited — enforced in the application *and* by a
  database trigger.
- Audit events are append-only, also by trigger. Normal application flows have no
  path to update or delete one.
- Document numbers are allocated by incrementing a namespace sequence inside the
  publish transaction, so two concurrent publications cannot receive the same
  number.

## Audit and redaction

Every state change writes an `AuditEvent` with actor, action, entity, a
permission-tagged before/after patch and a timestamp. System actors are recorded
distinctly from users.

Field names matching `password|secret|token|apikey|credential` are replaced with
`[redacted]` before the payload is written — the secret never reaches the table.
Viewers without the restricted-audit permission additionally see `[restricted]`
in place of sensitive values at read time.

## Untrusted input

**Document source** is parsed by our own parsers. Rendered plaintext is
HTML-escaped before any anchor is added; the HTMLizer only ever introduces `<a>`
and `<span>` wrappers around already-escaped text.

**Imported or pasted HTML** goes through `src/render/sanitize.ts`: an allowlist
of elements and attributes, `script`/`style`/`iframe`/`object`/`form`/`svg` and
friends dropped with their content, unknown elements unwrapped, and only
`http(s)`, `mailto:`, in-page fragments and internal absolute paths accepted as
URLs. `javascript:` and `data:` URLs are dropped.

**XML** is parsed by a reader that rejects any document containing a `DOCTYPE` or
`ENTITY` declaration, and resolves only the five predefined entities plus numeric
character references. There is no external entity resolution and therefore no
XXE surface.

**Slugs** are validated against a narrow pattern before any lookup. Artifact
storage keys are checked for traversal and resolved paths are asserted to stay
inside the storage root.

## Outbound requests

The server makes no outbound request unless `EXTERNAL_IMPORT_ENABLED=true`.

When enabled, `adapters/external.ts` is the only module that fetches, and it:

- accepts only references matching `rfc\d{1,5}` or `draft-[a-z0-9-]+`;
- builds the URL itself — a user-supplied URL is never fetched;
- requires `https:` and a host from the allowlist derived from
  `UPSTREAM_DATATRACKER_BASE` / `UPSTREAM_RFC_EDITOR_BASE`;
- refuses redirects (`redirect: 'error'`), so a redirect cannot escape the
  allowlist;
- enforces a timeout and a byte limit on both the declared and the actual
  response size;
- sanitizes the response before storing it.

That combination is what closes the SSRF path: no user-controlled host, no
redirect following, no internal address reachable.

## Sessions and credentials

Session cookies are `httpOnly`, `sameSite=lax`, and `secure` when `APP_BASE_URL`
is https. The cookie carries an opaque session id plus an HMAC, so a tampered
value is rejected before a database lookup. Sessions expire server-side.

Passwords are hashed with scrypt (random 16-byte salt, 64-byte derived key).
Sign-in always runs the KDF, including for unknown accounts, so timing does not
reveal whether a handle exists.

Invite and password-reset links carry a 256-bit token. Only its SHA-256 hash is
stored, so a dump of `credential_tokens` cannot be replayed into a working link.
A token is single use, expires (a week for invites, an hour for resets), and
issuing a new one of the same kind marks the previous one spent. Redeeming a link
or an administrator setting a password deletes every session for that account.

Resets are administrator-initiated. There is no public "forgot password" form, so
there is no endpoint to probe for valid handles. The redemption page reveals
nothing — not even whether the account exists — until a valid, unused, unexpired
token is presented.

Generated passwords and links are returned exactly once, in the server action's
response. They are never written to the database in readable form, never logged,
and never placed in the audit payload; `recordAudit` additionally redacts any
change field whose name looks like a credential.

State-changing operations are Next.js server actions, which are POST-only and
carry framework-level origin checks; there are no GET endpoints that mutate
state.

## What is deliberately not implemented

- **Rate limiting.** There is none at the application layer, including on the
  invite and reset redemption pages. Those are guarded by a 256-bit single-use
  token rather than by throttling; put the deployment behind a reverse proxy for
  internet-facing installs.
- **Email authenticity.** Outgoing mail is handed to the configured SMTP relay as
  plain text. SPF, DKIM and DMARC are the relay's responsibility, and the
  application does not sign or encrypt message bodies.
- **Content Security Policy headers.** The application ships no inline event
  handlers and one inline boot script; a strict CSP with a nonce belongs in the
  reverse proxy or in `next.config.mjs` headers for your deployment.
- **Secret management.** `SESSION_SECRET` and `ADMIN_SYNC_TOKEN` are read from
  the environment. They must be set to real values; the defaults are development
  placeholders and are not safe.

## Supported versions

DraftLedger is pre-1.0. Security fixes land on `main` and are released from
there; older tags are not backported. Run a recent `main` or the latest release.

| Version | Supported |
|---|---|
| `main` / latest release | Yes |
| Anything older | No |

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security
problem.** A public report tells everyone running DraftLedger about the hole at
the same moment it tells the maintainers.

Report privately through GitHub Security Advisories:

1. Go to <https://github.com/bkoroglu1/draftledger/security/advisories/new>
2. Describe the issue, the impact, and how to reproduce it

A report is most useful when it includes the affected version or commit, the
configuration that exposes the issue, and the smallest sequence of steps that
demonstrates it. Proof-of-concept code is welcome but not required.

### What to expect

- An acknowledgement within **7 days**
- An assessment of severity and affected versions within **30 days**
- Credit in the advisory and release notes, unless you prefer to stay anonymous

Please give the project reasonable time to ship a fix before disclosing
publicly. There is no bug bounty — this is an unfunded project — but genuine
reports are taken seriously and credited.

### Out of scope

- Vulnerabilities in a *deployment* rather than in the code: a missing reverse
  proxy, an exposed database port, a `SESSION_SECRET` left at its development
  default, or seed data left in a live installation
- The items under *What is deliberately not implemented* above, which are
  documented design decisions rather than defects — though an argument that one
  of them is the wrong decision is a legitimate issue, just not a private one
- Findings from automated scanners with no demonstrated impact

## Reporting non-security bugs

Ordinary bugs go to the public issue tracker. Operators can point their own
installation's in-app bug link at their internal tracker with `BUG_REPORT_URL`;
reports about an installation must not be sent to any external standards
organization.
