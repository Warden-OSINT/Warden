import { describe, expect, it } from 'vitest';
import { mapReputation, matchingIocs, reputationNotices, type ReputationSubject, type ThreatfoxIoc } from './mapper';

const observedAt = new Date('2026-10-16T00:00:00Z');
const clean = { query_status: 'no_results', urls: [] };
const subject = (overrides: Partial<ReputationSubject>): ReputationSubject => ({
  value: 'example.com', type: 'domain', resolvedFrom: [], urlhaus: clean, threatfox: [], feodo: [], ...overrides,
});
const ioc = (overrides: Partial<ThreatfoxIoc>): ThreatfoxIoc => ({
  id: '1', ioc: 'example.com', ioc_type: 'domain', threat_type: 'payload_delivery', malware_printable: 'Emotet', ...overrides,
});

describe('matchingIocs', () => {
  it('descarta coincidencias por subcadena y extrae el host de URLs e ip:port', () => {
    const iocs = [
      ioc({ id: '1', ioc: 'evil-example.com' }),
      ioc({ id: '2', ioc: 'http://example.com/payload.exe', ioc_type: 'url' }),
      ioc({ id: '3', ioc: '203.0.113.10:443', ioc_type: 'ip:port' }),
      ioc({ id: '4', ioc: 'EXAMPLE.com' }),
    ];
    expect(matchingIocs('example.com', iocs).map((i) => i.id)).toEqual(['2', '4']);
    expect(matchingIocs('203.0.113.10', iocs).map((i) => i.id)).toEqual(['3']);
  });
});

describe('mapReputation', () => {
  it('un activo limpio no produce hallazgos pero sí un aviso', () => {
    const subjects = [subject({ urlhaus: { ...clean, blacklists: { spamhaus_dbl: 'not listed', surbl: 'not listed' } } })];
    expect(mapReputation(subjects, observedAt)).toEqual([]);
    expect(reputationNotices(subjects)[0]).toMatchObject({
      kind: 'observation',
      subject: 'example.com',
      details: { urlhausTotal: 0, threatfoxIocs: 0, feodo: null, blocklists: [] },
    });
  });

  it('agrupa URLs por estado, listas y IOC en un hallazgo por regla', () => {
    const findings = mapReputation([subject({
      urlhaus: {
        query_status: 'ok',
        urls: [
          { id: '10', url: 'http://example.com/a.exe', url_status: 'online', threat: 'malware_download' },
          { id: '11', url: 'http://example.com/b.exe', url_status: 'online' },
          { id: '12', url: 'http://example.com/c.exe', url_status: 'offline' },
        ],
        blacklists: { spamhaus_dbl: 'abused_legit_malware', surbl: 'not listed' },
      },
      threatfox: [ioc({ threat_type: 'botnet_cc' })],
    })], observedAt);

    expect(findings.map((f) => [f.evidence.feed, f.severity, f.confidence])).toEqual([
      ['urlhaus', 'critical', 'high'],
      ['urlhaus', 'medium', 'high'],
      ['urlhaus', 'high', 'high'],
      ['threatfox', 'critical', 'high'],
    ]);
    expect(findings[0]?.evidence).toMatchObject({ urlCount: 2 });
    expect(findings[2]?.title).toBe('example.com aparece en Spamhaus DBL');
    expect(new Set(findings.map((f) => f.fingerprint)).size).toBe(4);
  });

  it('una IP en Feodo es crítica si está activa y tiene confianza media', () => {
    const [finding] = mapReputation([subject({
      value: '203.0.113.10',
      type: 'ip',
      resolvedFrom: ['vpn.example.com'],
      feodo: [{ ip_address: '203.0.113.10', port: 443, status: 'online', malware: 'QakBot' }],
    })], observedAt);
    expect(finding).toMatchObject({ severity: 'critical', confidence: 'medium', assetValue: '203.0.113.10' });
    expect(finding?.evidence).toMatchObject({ resolvedFrom: ['vpn.example.com'], active: true });
  });

  it('la huella no cambia con el número de URLs observadas', () => {
    const one = mapReputation([subject({ urlhaus: { query_status: 'ok', urls: [{ id: '1', url: 'u1', url_status: 'online' }] } })], observedAt);
    const two = mapReputation([subject({ urlhaus: { query_status: 'ok', urls: [
      { id: '1', url: 'u1', url_status: 'online' }, { id: '2', url: 'u2', url_status: 'online' },
    ] } })], observedAt);
    expect(one[0]?.fingerprint).toBe(two[0]?.fingerprint);
  });
});
