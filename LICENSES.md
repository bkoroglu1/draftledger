# Licences and attribution

## This project

DraftLedger is free software, licensed under the **GNU Affero General Public
License, version 3 or later** — see [LICENSE](LICENSE) for the full text.

In short: you may run, study, share and modify it. If you distribute a modified
version, or **run one as a network service**, you must make the corresponding
source of that version available to its users under the same licence. This is
the AGPL's section 13 obligation and it is the reason the application exposes an
`/about` page carrying `APP_SOURCE_URL`; operators running modified code must
point that variable at their own repository.

Contributions are accepted under the same licence. There is no CLA.

The fixtures under `seed/` — the documents, people, groups and disclosures — are
entirely fictional. They contain no real person, organization, standard number
or upstream metadata, and carry no third-party licence obligation.

## Runtime dependencies

| Package | Licence | Used for |
|---|---|---|
| `next` | MIT | Server-rendered application framework |
| `react`, `react-dom` | MIT | UI rendering |
| `drizzle-orm` | Apache-2.0 | Schema definition and query building |
| `pg` | MIT | PostgreSQL driver |
| `zod` | MIT | Input validation |
| `nodemailer` | MIT-0 | SMTP delivery for notifications and credential links |
| `server-only` | MIT | Build-time guard against importing server code into the client |

## Development dependencies

| Package | Licence | Used for |
|---|---|---|
| `typescript` | Apache-2.0 | Type checking |
| `vitest` | MIT | Unit and integration tests |
| `@playwright/test` | Apache-2.0 | End-to-end tests |
| `drizzle-kit` | MIT | Migration generation |
| `eslint`, `eslint-config-next` | MIT | Linting |
| `@types/*` | MIT | Type definitions |

Run `npm ls --all` for the full transitive tree, or `npx license-checker` for a
machine-readable report.

## Fonts and assets

No webfonts, icon fonts or CDN assets are used. The interface uses system font
stacks, preferring `Noto Sans Mono` for document text and `Inter` for UI text
when they are installed locally, falling back to the platform defaults. Nothing
is downloaded at runtime, which is what allows the application to work fully
offline and inside an air-gapped network.

Icons are Unicode characters, not image or font assets.

## Generated document artifacts

Artifacts produced by this installation (`txt`, `html`, `xml`, `pdf`, `bibtex`)
are derived from your own document sources. Their licence is the one recorded on
the document's licence profile, which is embedded in the published output. The
PDF writer uses the PDF base-14 `Courier` font, which is provided by the PDF
reader and requires no font licence.

## Imported external documents

If the optional import adapter is enabled, documents fetched from upstream keep
their own licence and attribution. DraftLedger stores the source URL, the fetch
time, the ETag and the checksum with every imported artifact, and displays the
provenance in the reader.

Before enabling the adapter, confirm that the upstream source's licence permits
storing and redistributing its documents inside your organization. That check is
per-source and is not something this software can make for you.

## Trademarks

DraftLedger is not operated by, affiliated with or endorsed by the IETF or any
other standards organization. No third-party logo or brand asset is bundled. The
product name, badge text, document numbering and publication series are all
configurable and belong to the operating organization.

When the external adapter is enabled, `EXTERNAL_ADAPTER_DISCLAIMER` is displayed
so readers are not misled about the origin of imported content.
