import { describe, expect, it } from 'vitest';
import { cveSeverity } from './cve-enrichment';
import { cdnNotices, mapExposure, type InternetDbHost } from './mapper';

const observedAt = new Date('2026-10-14T12:00:00Z');
const host = (ip: string, data: Partial<InternetDbHost>): InternetDbHost => ({
  ip, ports: [], cpes: [], hostnames: [], tags: [], vulns: [], ...data,
});

describe('mapExposure', () => {
  it('clasifica puertos por servicio, omite HTTP/HTTPS y genera un hallazgo por CVE', () => {
    const findings = mapExposure([{
      ip: '203.0.113.10',
      resolvedFrom: ['vpn.example.com'],
      data: host('203.0.113.10', {
        ports: [3389, 80, 443, 5432, 6379, 22, 8081, 3389],
        vulns: ['CVE-2024-0001'],
      }),
    }], observedAt);

    expect(findings.map((f) => [f.title, f.severity, f.confidence])).toEqual([
      ['Servicio SSH expuesto en 203.0.113.10:22', 'info', 'medium'],
      ['Servicio RDP expuesto en 203.0.113.10:3389', 'critical', 'medium'],
      ['Servicio PostgreSQL expuesto en 203.0.113.10:5432', 'high', 'medium'],
      ['Servicio Redis expuesto en 203.0.113.10:6379', 'critical', 'medium'],
      ['Puerto 8081 abierto en 203.0.113.10', 'info', 'medium'],
      ['Posible vulnerabilidad CVE-2024-0001 en 203.0.113.10', 'medium', 'low'],
    ]);
    expect(findings.every((f) => f.riskDomain === 'exposure' && f.assetValue === '203.0.113.10')).toBe(true);
    expect(findings[1]?.evidence).toMatchObject({ resolvedFrom: ['vpn.example.com'], port: 3389 });
  });

  it('sube la confianza cuando un CPE confirma el producto del puerto', () => {
    const [mysql, redis] = mapExposure([{
      ip: '203.0.113.10',
      resolvedFrom: [],
      data: host('203.0.113.10', { ports: [6379, 3306], cpes: ['cpe:/a:redis:redis:6.0.9'] }),
    }], observedAt).sort((a, b) => a.title.localeCompare(b.title));

    expect(mysql).toMatchObject({ confidence: 'medium', evidence: { serviceInferredFrom: 'port' } });
    expect(redis).toMatchObject({ confidence: 'high', evidence: { serviceInferredFrom: 'cpe' } });
  });

  it('clasifica CVE por KEV y EPSS y deja medium si no hay datos', () => {
    const enrichment = {
      kev: new Set(['CVE-2019-0708']),
      epss: new Map([['CVE-2021-1', 0.5], ['CVE-2021-2', 0.05], ['CVE-2021-3', 0.001]]),
    };
    expect(['CVE-2019-0708', 'CVE-2021-1', 'CVE-2021-2', 'CVE-2021-3', 'CVE-2021-4']
      .map((cve) => cveSeverity(cve, enrichment)))
      .toEqual(['critical', 'high', 'medium', 'low', 'medium']);

    const [finding] = mapExposure([{
      ip: '203.0.113.10', resolvedFrom: [], data: host('203.0.113.10', { vulns: ['CVE-2019-0708'] }),
    }], observedAt, enrichment);
    expect(finding).toMatchObject({ severity: 'critical', evidence: { inKev: true, epss: null } });
  });

  it('produce huellas estables entre escaneos y distintas por puerto', () => {
    const data = host('203.0.113.10', { ports: [3306, 5432] });
    const first = mapExposure([{ ip: data.ip, resolvedFrom: [], data }], observedAt);
    const second = mapExposure([{ ip: data.ip, resolvedFrom: ['db.example.com'], data }], new Date());
    expect(first.map((f) => f.fingerprint)).toEqual(second.map((f) => f.fingerprint));
    expect(new Set(first.map((f) => f.fingerprint)).size).toBe(2);
  });

  it('omite IPs de CDN y las IPs sin datos', () => {
    expect(mapExposure([
      { ip: '104.16.0.1', resolvedFrom: ['www.example.com'], data: host('104.16.0.1', { ports: [8080], tags: ['cdn'] }) },
      { ip: '203.0.113.20', resolvedFrom: [], data: null },
    ], observedAt)).toEqual([]);
  });
});

describe('cdnNotices', () => {
  it('avisa las IPs de CDN que mapExposure omite, con el proveedor del CPE', () => {
    const hosts = [
      {
        ip: '198.51.100.20',
        resolvedFrom: ['www.example.com'],
        data: host('198.51.100.20', {
          ports: [21, 3389, 3389],
          cpes: ['cpe:/a:imperva:incapsula'],
          hostnames: ['www.example.com', 'otro-sitio.com'],
          tags: ['cdn'],
        }),
      },
      { ip: '203.0.113.10', resolvedFrom: [], data: host('203.0.113.10', { ports: [3389] }) },
      { ip: '203.0.113.11', resolvedFrom: [], data: null },
    ];

    expect(mapExposure(hosts, observedAt).every((f) => f.assetValue === '203.0.113.10')).toBe(true);
    expect(cdnNotices(hosts)).toEqual([{
      kind: 'cdn',
      subject: '198.51.100.20',
      message: expect.stringContaining('(Imperva)'),
      details: expect.objectContaining({
        provider: 'Imperva',
        resolvedFrom: ['www.example.com'],
        portsObserved: 2,
        sharedHostnames: 2,
      }),
    }]);
  });

  it('sin CPE reconocible el proveedor queda en null', () => {
    const [notice] = cdnNotices([{ ip: '198.51.100.21', resolvedFrom: [], data: host('198.51.100.21', { tags: ['cdn'] }) }]);
    expect(notice?.details.provider).toBeNull();
  });
});
