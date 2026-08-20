import { afterEach, describe, expect, it, vi } from 'vitest';

/** Transport behaviour that must hold whether or not SMTP is configured. */

const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail: sendMailMock }),
}));

async function loadMail(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return import('#src/lib/mail.ts');
}

afterEach(() => {
  vi.unstubAllEnvs();
  sendMailMock.mockReset();
});

describe('mail transport', () => {
  it('is not configured without a host and a from address', async () => {
    const mail = await loadMail({ SMTP_HOST: '', SMTP_FROM: '' });
    expect(mail.mailConfigured()).toBe(false);
  });

  it('records why nothing was sent instead of throwing', async () => {
    const mail = await loadMail({ SMTP_HOST: '', SMTP_FROM: '' });
    const result = await mail.sendMail({ to: ['someone@example.invalid'], subject: 's', text: 't' });
    expect(result).toEqual({ status: 'skipped', errorClass: 'no_transport_configured' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('does not dial the server when there is no recipient', async () => {
    const mail = await loadMail({ SMTP_HOST: 'smtp.example.invalid', SMTP_FROM: 'a@example.invalid' });
    const result = await mail.sendMail({ to: [], cc: [], subject: 's', text: 't' });
    expect(result).toEqual({ status: 'skipped', errorClass: 'no_recipients' });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it('sends through the transport once configured', async () => {
    sendMailMock.mockResolvedValue({ messageId: '<abc@example.invalid>' });
    const mail = await loadMail({ SMTP_HOST: 'smtp.example.invalid', SMTP_FROM: 'a@example.invalid' });
    const result = await mail.sendMail({ to: ['b@example.invalid'], subject: 'Subject', text: 'Body' });

    expect(result.status).toBe('sent');
    expect(sendMailMock).toHaveBeenCalledOnce();
    expect(sendMailMock.mock.calls[0]![0]).toMatchObject({
      from: 'a@example.invalid',
      to: ['b@example.invalid'],
      subject: 'Subject',
    });
  });

  it('classifies a failure without leaking the address or body', async () => {
    sendMailMock.mockRejectedValue(Object.assign(new Error('nope'), { code: 'ECONNREFUSED' }));
    const mail = await loadMail({ SMTP_HOST: 'smtp.example.invalid', SMTP_FROM: 'a@example.invalid' });
    const result = await mail.sendMail({ to: ['b@example.invalid'], subject: 's', text: 't' });

    expect(result.status).toBe('failed');
    expect(result.errorClass).toBe('smtp_econnrefused');
    expect(JSON.stringify(result)).not.toContain('b@example.invalid');
  });
});
