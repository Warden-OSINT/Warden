import { describe, expect, it, vi } from 'vitest';
import { credentialsModule } from './credentials/analyzer';
import { emailModule } from './email/analyzer';
import { runRiskAnalysis } from './runner';
import type { EvidenceProvider } from './types';

const target = { primaryDomain: 'example.com', confirmedDomains: [] };
const context = { signal: new AbortController().signal, getSecret: () => undefined };
const envelope = { schemaVersion: 1, sourceKey: 'email_dns', subjectDomain: 'example.com',
  observedAt: '2026-10-12T12:00:00Z' };
const email = { ...envelope, spf: { status: 'ok', records: ['v=spf1 -all'] },
  dmarc: { status: 'ok', records: ['v=DMARC1; p=reject;'] },
  mx: { status: 'ok', records: ['0 .'] }, dkim: [] };
const credentials = { ...envelope, sourceKey: 'hibp',
  attribution: 'Have I Been Pwned — https://haveibeenpwned.com', breaches: [] };

describe('Análisis de correos', () => {
  it('distingue fallos DNS de ausencia y mantiene DKIM desconocido sin selectores', () => {
    const result = emailModule.analyze({ ...email, spf: { status: 'unavailable' },
      dmarc: { status: 'ok', records: [] } }, target);
    expect(result.observations.find((v) => v.ruleId === 'email.spf.records')?.state).toBe('unknown');
    expect(result.observations.find((v) => v.ruleId === 'email.dmarc.records')?.state).toBe('absent');
    expect(result.observations.find((v) => v.ruleId === 'email.dkim.selectors')?.state).toBe('unknown');
    expect(result.coverage).toBe('partial');
  });

  it('identifica Null MX, política DMARC y SPF permisivo sin calcular scores', () => {
    const result = emailModule.analyze({ ...email, spf: { status: 'ok', records: ['v=spf1 +all'] } }, target);
    expect(result.observations.find((v) => v.ruleId === 'email.mx.null')?.state).toBe('observed');
    expect(result.observations.find((v) => v.ruleId === 'email.dmarc.policy')?.details).toEqual({ policy: 'reject' });
    expect(result.observations.find((v) => v.ruleId === 'email.spf.allows-all')?.state).toBe('observed');
    expect(result).not.toHaveProperty('score');
  });

  it('no selecciona una política entre registros DMARC múltiples', () => {
    const result = emailModule.analyze({ ...email,
      dmarc: { status: 'ok', records: ['v=DMARC1; p=none', 'v=DMARC1; p=reject'] } }, target);
    expect(result.observations.some((v) => v.ruleId === 'email.dmarc.multiple-records')).toBe(true);
    expect(result.observations.some((v) => v.ruleId === 'email.dmarc.policy')).toBe(false);
  });

  it('rechaza evidencia de activos sin atribución confirmada', () => {
    expect(() => emailModule.analyze({ ...email, subjectDomain: 'example.com.attacker.org' }, target)).toThrow();
    expect(() => emailModule.analyze({ ...email, subjectDomain: 'mail.example.com' }, target)).toThrow();
    expect(emailModule.analyze({ ...email, subjectDomain: 'EXAMPLE.COM.' }, target).subjectDomain).toBe('example.com');
  });
});

describe('Análisis de credenciales', () => {
  it('no convierte correo expuesto en contraseña filtrada y conserva atribución', () => {
    const result = credentialsModule.analyze({ ...credentials, breaches: [{ breachId: 'ExampleBreach',
      affectedAccounts: 2, includesPasswords: false, verified: true }] }, target);
    expect(result.observations[0]?.details.passwordExposure).toBe('not-reported');
    expect(result.observations[0]?.details.attribution).toContain('Have I Been Pwned');
    expect(result.riskDomain).toBeNull();
  });

  it('conserva cobertura parcial aunque no existan resultados', () => {
    const result = credentialsModule.analyze(credentials, target);
    expect(result.coverage).toBe('partial');
    expect(result.observations[0]?.state).toBe('absent');
  });

  it('rechaza cuentas, contraseñas y duplicados en el contrato de evidencia', () => {
    for (const field of ['password', 'email', 'rawReference']) {
      expect(() => credentialsModule.analyze({ ...credentials, [field]: 'dato-sensible' }, target)).toThrow();
    }
    const breach = { breachId: 'ExampleBreach', affectedAccounts: 1, includesPasswords: true, verified: true };
    expect(() => credentialsModule.analyze({ ...credentials, breaches: [breach, breach] }, target)).toThrow();
  });
});

describe('Ejecutor compartido', () => {
  const policy = { sourceKey: 'email_dns', isEnabled: true, isNoContact: true };
  const provider: EvidenceProvider = { sourceKey: 'email_dns', moduleKey: 'email', isNoContact: true,
    collect: async () => email };

  it('bloquea antes de ejecutar fuentes ausentes o activas y omite deshabilitadas', async () => {
    const collect = vi.fn(provider.collect);
    expect((await runRiskAnalysis(target, [{ ...provider, collect }], [], context))[0]?.status).toBe('blocked');
    expect((await runRiskAnalysis(target, [{ ...provider, collect }], [{ ...policy, isNoContact: false }], context))[0]?.status).toBe('blocked');
    expect((await runRiskAnalysis(target, [{ ...provider, collect }], [{ ...policy, isEnabled: false }], context))[0]?.status).toBe('skipped');
    expect(collect).not.toHaveBeenCalled();
  });

  it('aísla fallos y no propaga evidencia sensible en errores', async () => {
    const bad: EvidenceProvider = { sourceKey: 'hibp', moduleKey: 'credentials', isNoContact: true,
      collect: async () => { throw new Error('password=secreto'); } };
    const result = await runRiskAnalysis(target, [bad, provider], [policy,
      { sourceKey: 'hibp', isEnabled: true, isNoContact: true }], context);
    expect(result.map((v) => v.status)).toEqual(['failed', 'ok']);
    expect(JSON.stringify(result)).not.toContain('secreto');
  });

  it('rechaza evidencia que suplanta una fuente y respeta cancelación', async () => {
    expect((await runRiskAnalysis(target, [{ ...provider, collect: async () => ({ ...email, sourceKey: 'other' }) }],
      [policy], context))[0]?.status).toBe('failed');
    const controller = new AbortController();
    controller.abort();
    await expect(runRiskAnalysis(target, [provider], [policy], { ...context, signal: controller.signal })).rejects.toThrow();
  });
});
