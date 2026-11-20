import { describe, expect, it } from 'vitest';
import { analyzeCertificates, issuerOrganization, parseCaa, parseCrtshDate } from './certs';
import type { CrtshEntry } from './mapper';

const now = new Date('2026-10-28T00:00:00Z');
const LE = "C=US, O=Let's Encrypt, CN=R11";
const DIGICERT = 'C=US, O="DigiCert, Inc.", CN=DigiCert Global G2 TLS RSA SHA256 2020 CA1';

const cert = (name_value: string, not_before: string, not_after: string, issuer_name = LE, serial = name_value + not_before): CrtshEntry =>
  ({ name_value, not_before, not_after, issuer_name, serial_number: serial });

const rules = (entries: CrtshEntry[], caa: string[] | undefined = ['0 issue "letsencrypt.org"']) =>
  analyzeCertificates({ entries, domain: 'example.com', caa, now }).findings.map((f) => [f.evidence.ruleId, f.title]);

describe('utilidades de certificados', () => {
  it('interpreta fechas de crt.sh como UTC', () => {
    expect(parseCrtshDate('2026-10-01T12:00:00').toISOString()).toBe('2026-10-01T12:00:00.000Z');
  });

  it('extrae la organización emisora, con o sin comillas', () => {
    expect(issuerOrganization(LE)).toBe("Let's Encrypt");
    expect(issuerOrganization(DIGICERT)).toBe('DigiCert, Inc.');
  });

  it('lee issue/issuewild y trata issue ";" como ninguna CA', () => {
    expect([...parseCaa(['0 issue "letsencrypt.org; validationmethods=dns-01"', '0 iodef "mailto:x@example.com"']).issuers])
      .toEqual(['letsencrypt.org']);
    expect(parseCaa(['0 issue ";"'])).toEqual({ issuers: new Set(), hasIssue: true });
  });
});

describe('analyzeCertificates', () => {
  it('reporta comodines vigentes una sola vez y no los vencidos', () => {
    const findings = rules([
      cert('*.example.com\nexample.com', '2026-09-01T00:00:00', '2026-12-01T00:00:00'),
      cert('*.example.com', '2026-09-02T00:00:00', '2026-12-02T00:00:00'),
      cert('*.old.example.com', '2025-01-01T00:00:00', '2025-04-01T00:00:00'),
    ]);
    expect(findings.filter(([rule]) => rule === 'certs.wildcard'))
      .toEqual([['certs.wildcard', 'Certificado comodín vigente para *.example.com']]);
  });

  it('marca vencimientos próximos o recientes solo si no hay renovación', () => {
    const findings = rules([
      cert('api.example.com', '2026-08-01T00:00:00', '2026-11-05T00:00:00'),
      cert('shop.example.com', '2026-08-01T00:00:00', '2026-11-05T00:00:00'),
      cert('shop.example.com', '2026-10-20T00:00:00', '2027-01-18T00:00:00'),
      cert('legacy.example.com', '2026-07-01T00:00:00', '2026-10-10T00:00:00'),
      cert('retired.example.com', '2025-01-01T00:00:00', '2025-04-01T00:00:00'),
    ]);
    expect(findings.filter(([rule]) => rule === 'certs.expiry')).toEqual([
      ['certs.expiry', 'Certificado de api.example.com vence el 2026-11-05 sin renovación en CT'],
      ['certs.expiry', 'Certificado de legacy.example.com venció el 2026-10-10 sin renovación en CT'],
    ]);
  });

  it('usa una huella estable para el mismo nombre al pasar de por vencer a vencido', () => {
    const entries = [cert('api.example.com', '2026-08-01T00:00:00', '2026-11-05T00:00:00')];
    const before = analyzeCertificates({ entries, domain: 'example.com', caa: [], now }).findings
      .find((f) => f.evidence.ruleId === 'certs.expiry');
    const after = analyzeCertificates({ entries, domain: 'example.com', caa: [], now: new Date('2026-11-10T00:00:00Z') })
      .findings.find((f) => f.evidence.ruleId === 'certs.expiry');
    expect(after?.fingerprint).toBe(before?.fingerprint);
    expect([before?.severity, after?.severity]).toEqual(['medium', 'low']);
  });

  it('reporta la falta de CAA y omite reglas de CAA si la consulta falló', () => {
    const entries = [cert('example.com', '2026-10-01T00:00:00', '2026-12-30T00:00:00')];
    expect(rules(entries, [])).toEqual([['certs.caa.missing', 'Sin registro CAA en example.com: cualquier CA puede emitir certificados']]);
    expect(rules(entries, undefined)).toEqual([]);
  });

  it('reporta emisoras recientes no autorizadas en CAA y deduplica precertificados', () => {
    const findings = analyzeCertificates({
      entries: [
        cert('example.com', '2026-10-01T00:00:00', '2026-12-30T00:00:00'),
        cert('pay.example.com', '2026-10-02T00:00:00', '2027-10-02T00:00:00', DIGICERT, 'S1'),
        cert('pay.example.com', '2026-10-02T00:00:00', '2027-10-02T00:00:00', DIGICERT, 'S1'),
        // Emitido antes de la ventana: el CAA de entonces pudo ser otro.
        cert('old.example.com', '2026-01-02T00:00:00', '2027-01-02T00:00:00', DIGICERT, 'S2'),
        cert('x.example.com', '2026-10-02T00:00:00', '2027-01-02T00:00:00', 'C=XX, O=CA Desconocida, CN=Y'),
      ],
      domain: 'example.com',
      caa: ['0 issue "letsencrypt.org"'],
      now,
    }).findings.filter((f) => f.evidence.ruleId === 'certs.caa.issuer-not-allowed');

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      assetValue: 'example.com',
      severity: 'medium',
      evidence: { issuer: 'DigiCert, Inc.', names: ['pay.example.com'] },
    });
  });

  it('ignora nombres ajenos al dominio evaluado', () => {
    expect(rules([cert('*.example.com.evil.net', '2026-10-01T00:00:00', '2026-12-30T00:00:00')])).toEqual([]);
  });
});
