// No `server-only` guard here on purpose: the worker and the migrate entrypoint
// run this under plain node, outside the Next bundler, where that import throws.
import { createTransport, type Transporter } from 'nodemailer';
import { config } from './config.ts';

/**
 * SMTP transport. The rest of the application asks whether mail is configured
 * and records why a delivery did not happen, so an unconfigured installation
 * degrades to "recorded but not sent" instead of failing or silently dropping.
 */

export interface MailMessage {
  to: string[];
  cc?: string[];
  subject: string;
  text: string;
}

export interface MailResult {
  status: 'sent' | 'skipped' | 'failed';
  /** Stable, loggable reason. Never contains an address or a token. */
  errorClass?: string;
  messageId?: string;
}

export function mailConfigured(): boolean {
  return Boolean(config.mail.host && config.mail.from);
}

let cached: Transporter | null = null;

function transporter(): Transporter {
  if (cached) return cached;
  cached = createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
    connectionTimeout: config.mail.timeoutMs,
    greetingTimeout: config.mail.timeoutMs,
    socketTimeout: config.mail.timeoutMs,
  });
  return cached;
}

/** Test seam: forces the next send to build a fresh transport. */
export function resetMailTransport(): void {
  cached = null;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  if (!mailConfigured()) return { status: 'skipped', errorClass: 'no_transport_configured' };
  if (!message.to.length && !message.cc?.length) {
    return { status: 'skipped', errorClass: 'no_recipients' };
  }

  try {
    const info = await transporter().sendMail({
      from: config.mail.from,
      to: message.to,
      cc: message.cc?.length ? message.cc : undefined,
      subject: message.subject,
      text: message.text,
    });
    return { status: 'sent', messageId: info.messageId };
  } catch (err) {
    // The message body and addresses stay out of the recorded reason.
    return { status: 'failed', errorClass: classifyMailError(err) };
  }
}

function classifyMailError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (typeof code === 'string' && code) return `smtp_${code.toLowerCase()}`;
  const response = (err as { responseCode?: number })?.responseCode;
  if (typeof response === 'number') return `smtp_${response}`;
  return 'smtp_unknown';
}
