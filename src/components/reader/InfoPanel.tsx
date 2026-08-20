import Link from 'next/link';
import { config } from '#src/lib/config.ts';
import type { AuthorView, RelationView } from '#src/services/documents.ts';
import { CompareControls, type RevisionOption } from './CompareControls.tsx';

export interface InfoPanelProps {
  documentSlug: string;
  documentLabel: string;
  documentType: string;
  statusLabel: string;
  origin: string;
  createdAt: Date;
  lastRevisedAt: Date | null;
  publishedAt: Date | null;
  pages: number | null;
  seriesLabel: string;
  groupSlug: string | null;
  groupName: string | null;
  ownerName: string | null;
  ownerHandle: string | null;
  authors: AuthorView[];
  reviewers: Array<{ handle: string; displayName: string }>;
  approvers: Array<{ handle: string; displayName: string }>;
  relations: {
    updates: RelationView[];
    updatedBy: RelationView[];
    obsoletes: RelationView[];
    obsoletedBy: RelationView[];
    derivedFrom: RelationView[];
    replaces: RelationView[];
  };
  wasDraft: { slug: string; label: string } | null;
  errataCounts: Record<string, number>;
  disclosureCount: number;
  revisionOptions: RevisionOption[];
  currentRevisionSlug: string;
  currentRevisionLabel: string;
  checksum: string;
  parserVersion: string;
  rendererVersion: string;
  syncState: string;
  lastSyncedAt: Date | null;
  sourceUrl: string | null;
  canReportErrata: boolean;
  canStartUpdate: boolean;
  discussionHref: string;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="dl-info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function relationLinks(list: RelationView[]) {
  if (!list.length) return <span className="dl-muted">—</span>;
  return (
    <span className="dl-chip-row">
      {list.map((r) => (
        <Link key={`${r.type}-${r.targetSlug}`} className="dl-chip" href={`/doc/html/${r.targetSlug}`}>
          {r.targetNumber ?? r.targetSlug}
        </Link>
      ))}
    </span>
  );
}

export function InfoPanel(props: InfoPanelProps) {
  const errataTotal = Object.values(props.errataCounts).reduce((a, b) => a + b, 0);
  const dateFmt = (d: Date | null) =>
    d ? new Date(d).toISOString().slice(0, 10) : <span className="dl-muted">—</span>;

  return (
    <div>
      <dl className="dl-info-list">
        <Row label="Document type">
          {props.documentType} — {props.statusLabel}
        </Row>
        <Row label="Created">{dateFmt(props.createdAt)}</Row>
        <Row label="Last revision">{dateFmt(props.lastRevisedAt)}</Row>
        <Row label="Published">{dateFmt(props.publishedAt)}</Row>
        {props.pages ? <Row label="Pages">{props.pages}</Row> : null}
        <Row label="Errata">
          <Link href={`/doc/${props.documentSlug}/errata`}>View errata</Link>
          {errataTotal ? <span className="dl-muted"> ({errataTotal})</span> : null}
          {props.canReportErrata ? (
            <>
              {' · '}
              <Link href={`/doc/${props.documentSlug}/errata/new`}>Report errata</Link>
            </>
          ) : null}
        </Row>
        <Row label="IPR">
          <Link href={`/doc/${props.documentSlug}/ipr`}>
            {props.disclosureCount} disclosure{props.disclosureCount === 1 ? '' : 's'}
          </Link>
        </Row>
        <Row label="Updates">{relationLinks(props.relations.updates)}</Row>
        <Row label="Updated by">{relationLinks(props.relations.updatedBy)}</Row>
        <Row label="Obsoletes">{relationLinks(props.relations.obsoletes)}</Row>
        <Row label="Obsoleted by">{relationLinks(props.relations.obsoletedBy)}</Row>
        <Row label="Derived from">{relationLinks(props.relations.derivedFrom)}</Row>
        <Row label="Was draft">
          {props.wasDraft ? (
            <Link href={`/doc/html/${props.wasDraft.slug}`}>{props.wasDraft.label}</Link>
          ) : (
            <span className="dl-muted">—</span>
          )}
        </Row>
        <Row label="Series">
          {props.seriesLabel}
          {props.groupSlug ? (
            <>
              {' · '}
              <Link href={`/groups/${props.groupSlug}`}>{props.groupName}</Link>
            </>
          ) : null}
        </Row>
        <Row label="Owner">
          {props.ownerHandle ? (
            <Link href={`/people/${props.ownerHandle}`}>{props.ownerName}</Link>
          ) : (
            <span className="dl-muted">—</span>
          )}
        </Row>
        <Row label="Authors">
          {props.authors.length ? (
            <ul style={{ margin: 0, paddingLeft: '1rem' }}>
              {props.authors.map((a) => (
                <li key={`${a.personId}-${a.role}`}>
                  <Link href={`/people/${a.handle}`}>{a.displayName}</Link>
                  {a.role === 'editor' ? <span className="dl-muted"> (editor)</span> : null}
                  {a.email ? (
                    <>
                      {' '}
                      <a href={`mailto:${a.email}`} title="Email this author">
                        ✉
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <span className="dl-muted">—</span>
          )}
        </Row>
        <Row label="Reviewers">
          {props.reviewers.length ? (
            props.reviewers.map((r) => (
              <span key={r.handle}>
                <Link href={`/people/${r.handle}`}>{r.displayName}</Link>{' '}
              </span>
            ))
          ) : (
            <span className="dl-muted">—</span>
          )}
        </Row>
        <Row label="Approvers">
          {props.approvers.length ? (
            props.approvers.map((r) => (
              <span key={r.handle}>
                <Link href={`/people/${r.handle}`}>{r.displayName}</Link>{' '}
              </span>
            ))
          ) : (
            <span className="dl-muted">—</span>
          )}
        </Row>
        <Row label="Provenance">
          <span className="dl-mono" title="Canonical source checksum">
            {props.checksum.slice(0, 12)}
          </span>
          <br />
          <span className="dl-muted">
            {props.parserVersion} · {props.rendererVersion}
          </span>
          {props.origin !== 'local' ? (
            <>
              <br />
              <span className="dl-muted">
                {props.origin} · {props.syncState}
                {props.lastSyncedAt ? ` · synced ${new Date(props.lastSyncedAt).toISOString().slice(0, 10)}` : ''}
              </span>
              {props.sourceUrl ? (
                <>
                  <br />
                  <a href={props.sourceUrl} rel="noopener noreferrer nofollow" target="_blank">
                    Upstream source
                  </a>
                </>
              ) : null}
            </>
          ) : null}
        </Row>
      </dl>

      <h3 style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>Select version</h3>
      <div className="dl-chip-row">
        {props.revisionOptions.map((o) => (
          <Link
            key={o.slug}
            className="dl-chip"
            href={`/doc/html/${o.slug}`}
            aria-current={o.slug === props.currentRevisionSlug ? 'true' : undefined}
            title={`${o.date} · ${o.checksum}`}
          >
            {o.label}
          </Link>
        ))}
      </div>

      <h3 style={{ fontSize: '0.875rem', margin: '1rem 0 0.25rem' }}>Compare versions</h3>
      <CompareControls
        options={props.revisionOptions}
        defaultFrom={
          props.revisionOptions[props.revisionOptions.length - 2]?.slug ??
          props.revisionOptions[0]?.slug ??
          props.currentRevisionSlug
        }
        defaultTo={props.currentRevisionSlug}
      />

      <h3 style={{ fontSize: '0.875rem', margin: '1rem 0 0.25rem' }}>Other formats</h3>
      <div className="dl-chip-row">
        <a className="dl-chip" href={`/artifacts/${props.currentRevisionSlug}/txt`}>
          txt
        </a>
        <a className="dl-chip" href={`/artifacts/${props.currentRevisionSlug}/html`}>
          html
        </a>
        <Link className="dl-chip" href={`/doc/html/${props.currentRevisionSlug}`}>
          htmlized
        </Link>
        <Link className="dl-chip" href={`/doc/${props.documentSlug}/errata?view=with-errata`}>
          w/errata
        </Link>
        <a className="dl-chip" href={`/artifacts/${props.currentRevisionSlug}/pdf`}>
          pdf
        </a>
        <Link className="dl-chip" href={`/doc/${props.documentSlug}/bibtex`}>
          bibtex
        </Link>
      </div>

      <h3 style={{ fontSize: '0.875rem', margin: '1rem 0 0.25rem' }}>Additional resources</h3>
      <ul style={{ margin: 0, paddingLeft: '1rem' }}>
        <li>
          <Link href={props.discussionHref}>Discussion &amp; review threads</Link>
        </li>
        <li>
          <Link href={`/doc/${props.documentSlug}`}>Document status &amp; provenance</Link>
        </li>
        <li>
          <Link href={`/doc/${props.documentSlug}/history`}>History</Link>
        </li>
        <li>
          <Link href={`/doc/${props.documentSlug}/references`}>References</Link>
        </li>
        <li>
          <Link href={`/doc/${props.documentSlug}/referenced-by`}>Referenced by</Link>
        </li>
        <li>
          <Link href={`/doc/${props.documentSlug}/email-expansions`}>Notification expansions</Link>
        </li>
        {props.canStartUpdate ? (
          <li>
            <Link href={`/drafts/new?mode=update&source=${props.documentSlug}`}>
              Start update draft
            </Link>
          </li>
        ) : null}
        <li>
          <Link href={`/drafts/new?mode=fork&source=${props.documentSlug}`}>Create local fork</Link>
        </li>
      </ul>

      <p className="dl-pref-hint" style={{ marginTop: '1rem' }}>
        <a href={config.app.bugReportUrl} rel="noopener noreferrer nofollow" target="_blank">
          Report a reader bug
        </a>
      </p>
    </div>
  );
}
