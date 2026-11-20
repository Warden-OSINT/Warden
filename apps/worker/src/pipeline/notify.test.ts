import { describe, expect, it } from 'vitest';
import { emailRecipients } from './alerts';
import { buildAlertEmail, type AlertEmailContext } from './email-alert';
import { afterFailure, EMAIL_MAX_ATTEMPTS, emailPayloadSchema } from './notify';

const base: AlertEmailContext = {
  companyName: 'Empresa',
  primaryDomain: 'empresa.com',
  type: 'grade_drop',
  previousGrade: 'B',
  newGrade: 'D',
  globalScore: 63.456,
  thresholdGrade: null,
  computedAt: '2026-11-04T22:01:30Z',
  reportUrl: 'https://warden.empresa.com/reports/abc',
};

describe('buildAlertEmail', () => {
  it('describe la baja de nota con KRI y enlace al reporte', () => {
    const email = buildAlertEmail(base);
    expect(email.subject).toBe('[Warden] La nota de Empresa bajó de B a D');
    expect(email.text).toContain('Nota: B → D (KRI 63.5 de 100)');
    expect(email.text).toContain('https://warden.empresa.com/reports/abc');
    expect(email.html).toContain('href="https://warden.empresa.com/reports/abc"');
  });

  it('menciona el umbral al cruzarlo y funciona sin enlace', () => {
    const email = buildAlertEmail({ ...base, type: 'threshold_crossed', previousGrade: null, thresholdGrade: 'C', reportUrl: null });
    expect(email.subject).toBe('[Warden] La nota de Empresa quedó en D, por debajo del umbral C');
    expect(email.text).toContain('Consulta el reporte completo en Warden.');
  });

  it('escapa el HTML de los datos', () => {
    const email = buildAlertEmail({ ...base, companyName: '<script>x</script>' });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('afterFailure', () => {
  const now = new Date('2026-11-04T22:00:00Z');

  it('reintenta con espera creciente', () => {
    expect(afterFailure(1, now)).toEqual({ status: 'pending', nextAttemptAt: new Date('2026-11-04T22:01:00Z') });
    expect(afterFailure(4, now)).toEqual({ status: 'pending', nextAttemptAt: new Date('2026-11-04T23:00:00Z') });
  });

  it('marca failed al agotar los intentos', () => {
    expect(afterFailure(EMAIL_MAX_ATTEMPTS, now)).toEqual({ status: 'failed' });
  });
});

describe('destinatarios', () => {
  it('solo toma correos válidos de alert_settings.recipients', () => {
    expect(emailRecipients(['a@empresa.com', 'no-es-correo', 3, null])).toEqual(['a@empresa.com']);
    expect(emailRecipients(null)).toEqual([]);
  });

  it('el payload exige al menos un destinatario', () => {
    expect(emailPayloadSchema.safeParse({ recipients: [], thresholdGrade: null }).success).toBe(false);
    expect(emailPayloadSchema.safeParse({ recipients: ['a@empresa.com'], thresholdGrade: 'C' }).success).toBe(true);
  });
});
