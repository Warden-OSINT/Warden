import nodemailer from 'nodemailer';
import { config } from './config';
import type { Mailer } from './pipeline/notify';

/**
 * Cliente SMTP de las alertas. null si SMTP_HOST no está configurado: los envíos quedan
 * 'pending' en integration_outbox y salen cuando se configure.
 */
export function createSmtpMailer(): Mailer | null {
  if (!config.SMTP_HOST) return null;
  const transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE,
    auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return {
    async send(message) {
      await transport.sendMail(message);
    },
  };
}
