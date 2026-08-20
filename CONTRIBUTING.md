# Contributing to DraftLedger

Thanks for taking the time to look at this. DraftLedger is a small, deliberately
conservative codebase: it manages documents that organizations treat as
authoritative records, so changes are judged first on whether they preserve that
guarantee.

## Ground rules

By contributing you agree that your work is licensed under the
[GNU AGPL-3.0](LICENSE), the same terms as the project. There is no CLA.

Please read [SECURITY.md](SECURITY.md) before reporting anything that looks like
a vulnerability — **do not open a public issue for it.**

## Getting set up

You need Node.js 22.9 or newer and a PostgreSQL 16+ database.

```bash
cp .env.example .env.local
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

The seed creates fictional people, teams and documents so you have something to
click. Every seeded account uses the password `draftledger` and every seeded
address is on the reserved `example.invalid` domain. **This data is for
development only — never run `db:seed` against an installation that matters.**

If you prefer containers, `docker compose up --build` brings up the database,
migrations, web app and worker together.

## Before you open a pull request

Run the full gate. CI runs exactly this and nothing merges red:

```bash
npm run verify && npm run test:integration && npm run test:e2e
```

- `npm run verify` — TypeScript, ESLint (zero warnings allowed) and unit tests
- `npm run test:integration` — requires a live database
- `npm run test:e2e` — Playwright; run `npx playwright install` once first

## What makes a change likely to be accepted

- **Tests come with it.** New behaviour needs a test that fails without the
  change. Bug fixes need a test that reproduces the bug.
- **Published records stay immutable.** Published revisions, approvals bound to
  a revision checksum, and the append-only audit log are load-bearing
  guarantees. A change that lets any of them be rewritten in place will be
  rejected regardless of how convenient it is.
- **No silent destructive behaviour.** Anything that drops or overwrites data
  needs an explicit, documented opt-in — see `scripts/reset.ts` for the pattern.
- **Nothing phones home.** The application must remain fully functional with no
  internet connection. The external import adapter stays disabled by default.
- **It matches the surrounding code.** Match the existing naming, comment
  density and structure rather than introducing a new style.

## Commit and PR style

Write commit subjects in the imperative mood ("add errata filter", not "added"
or "adds"). Explain *why* in the body when the reason is not obvious from the
diff.

Keep pull requests focused on one thing. A PR that fixes a bug and also
reformats four unrelated files is much harder to review than two PRs.

## Reporting bugs and proposing features

Use the issue templates. For bugs, the single most useful thing you can include
is the smallest document or sequence of actions that reproduces the problem.

For anything large, please open an issue to discuss it before writing the code —
it is much cheaper to disagree about an approach in an issue than in a
900-line pull request.

## Documentation

[README.md](README.md) is the operator's guide, [ARCHITECTURE.md](ARCHITECTURE.md)
explains how the pieces fit together, and [SECURITY.md](SECURITY.md) is the
threat model. If your change alters behaviour any of them describes, update them
in the same pull request.
