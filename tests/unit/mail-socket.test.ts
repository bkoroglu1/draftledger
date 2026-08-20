import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Exercises the transport against a real socket speaking SMTP, so the wiring is
 * proven rather than mocked: dial, envelope, DATA, delivery.
 */

const lines: string[] = [];
let server: net.Server;
let port: number;

beforeAll(async () => {
  server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    socket.write('220 sink.invalid ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') {
            inData = false;
            socket.write('250 OK queued\r\n');
          } else {
            lines.push(line);
          }
          continue;
        }
        const cmd = line.split(' ')[0]!.toUpperCase();
        if (cmd === 'EHLO' || cmd === 'HELO') socket.write('250-sink.invalid\r\n250 SIZE 10240000\r\n');
        else if (cmd === 'MAIL' || cmd === 'RCPT') {
          lines.push(line);
          socket.write('250 OK\r\n');
        } else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 End with .\r\n');
        } else if (cmd === 'QUIT') {
          socket.write('221 Bye\r\n');
          socket.end();
        } else socket.write('250 OK\r\n');
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as net.AddressInfo).port;
});

afterAll(() => {
  server.close();
  vi.unstubAllEnvs();
});

describe('smtp delivery over a socket', () => {
  it('dials the server and delivers the envelope and body', async () => {
    vi.stubEnv('SMTP_HOST', '127.0.0.1');
    vi.stubEnv('SMTP_PORT', String(port));
    vi.stubEnv('SMTP_FROM', 'vault@example.invalid');
    vi.stubEnv('SMTP_SECURE', 'false');
    vi.resetModules();

    const mail = await import('#src/lib/mail.ts');
    expect(mail.mailConfigured()).toBe(true);

    const result = await mail.sendMail({
      to: ['recipient@example.invalid'],
      subject: 'Invite test',
      text: 'https://example.invalid/invite/TOKEN',
    });

    expect(result.status).toBe('sent');
    expect(lines.some((l) => l.startsWith('MAIL FROM') && l.includes('vault@example.invalid'))).toBe(true);
    expect(lines.some((l) => l.startsWith('RCPT TO') && l.includes('recipient@example.invalid'))).toBe(true);
    expect(lines.some((l) => l.includes('Invite test'))).toBe(true);
    expect(lines.some((l) => l.includes('/invite/TOKEN'))).toBe(true);
  });
});
