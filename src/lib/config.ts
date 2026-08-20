/**
 * Central runtime configuration. Everything an operator can tune lives here so
 * no branding, namespace or upstream host is hard-coded in UI components.
 */

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

function int(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

export type SyncMode = 'disabled' | 'on-demand' | 'mirror';

export const config = {
  app: {
    baseUrl: str('APP_BASE_URL', 'http://localhost:3000'),
    /** Blue badge label in the reader sidebar. Never defaults to a third-party name. */
    brandName: str('APP_BRAND_NAME', 'Standards Vault'),
    orgName: str('APP_ORG_NAME', 'Example Organization'),
    bugReportUrl: str('BUG_REPORT_URL', 'https://example.invalid/draftledger/issues'),
    /**
     * AGPL-3.0 section 13: everyone who interacts with this instance over a
     * network must be offered its Corresponding Source. If you modify
     * DraftLedger, point this at the repository carrying *your* changes —
     * leaving it on upstream does not discharge the obligation.
     */
    sourceUrl: str('APP_SOURCE_URL', 'https://github.com/bkoroglu1/draftledger'),
    externalAdapterDisclaimer: str(
      'EXTERNAL_ADAPTER_DISCLAIMER',
      'This installation is not operated by or affiliated with the IETF.',
    ),
  },
  documents: {
    /** Default publication namespace prefix, e.g. ORG-RFC-0042. */
    defaultNamespace: str('DOCUMENT_NAMESPACE', 'ORG-RFC'),
  },
  db: {
    url: str('DATABASE_URL', 'postgresql://draftledger:draftledger@localhost:5432/draftledger'),
    poolMax: int('DATABASE_POOL_MAX', 10),
  },
  storage: {
    kind: str('ARTIFACT_STORAGE', 'local') as 'local' | 's3',
    dir: str('ARTIFACT_DIR', './data/artifacts'),
    s3: {
      endpoint: str('S3_ENDPOINT', ''),
      bucket: str('S3_BUCKET', ''),
      region: str('S3_REGION', ''),
      accessKeyId: str('S3_ACCESS_KEY_ID', ''),
      secretAccessKey: str('S3_SECRET_ACCESS_KEY', ''),
    },
  },
  security: {
    sessionSecret: str('SESSION_SECRET', 'dev-only-session-secret-change-me'),
    adminSyncToken: str('ADMIN_SYNC_TOKEN', ''),
    sessionTtlSeconds: int('SESSION_TTL_SECONDS', 60 * 60 * 12),
    /** Invite links are long-lived; reset links are deliberately not. */
    inviteTtlSeconds: int('INVITE_TTL_SECONDS', 60 * 60 * 24 * 7),
    resetTtlSeconds: int('RESET_TTL_SECONDS', 60 * 60),
  },
  external: {
    enabled: bool('EXTERNAL_IMPORT_ENABLED', false),
    syncMode: str('SYNC_MODE', 'disabled') as SyncMode,
    syncSchedule: str('SYNC_SCHEDULE', '0 */6 * * *'),
    datatrackerBase: str('UPSTREAM_DATATRACKER_BASE', 'https://datatracker.ietf.org'),
    rfcEditorBase: str('UPSTREAM_RFC_EDITOR_BASE', 'https://www.rfc-editor.org'),
    fetchTimeoutMs: int('UPSTREAM_FETCH_TIMEOUT_MS', 15000),
    maxBytes: int('UPSTREAM_MAX_BYTES', 8 * 1024 * 1024),
  },
  mail: {
    /** With no host configured nothing is sent and deliveries record why. */
    host: str('SMTP_HOST', ''),
    port: int('SMTP_PORT', 587),
    /** Implicit TLS (port 465). Otherwise STARTTLS is negotiated. */
    secure: bool('SMTP_SECURE', false),
    user: str('SMTP_USER', ''),
    password: str('SMTP_PASSWORD', ''),
    from: str('SMTP_FROM', ''),
    timeoutMs: int('SMTP_TIMEOUT_MS', 15000),
  },
  worker: {
    concurrency: int('WORKER_CONCURRENCY', 2),
    pollIntervalMs: int('WORKER_POLL_INTERVAL_MS', 1000),
  },
} as const;

/** Host allowlist for any server-side outbound fetch. Nothing else is reachable. */
export function upstreamAllowlist(): string[] {
  return [config.external.datatrackerBase, config.external.rfcEditorBase]
    .filter(Boolean)
    .map((u) => {
      try {
        return new URL(u).host;
      } catch {
        return '';
      }
    })
    .filter(Boolean);
}
