// Datos de ejemplo para ver el dashboard en desarrollo sin Supabase
// (WARDEN_DEV_SKIP_AUTH=true y sin sesión). Con sesión, el dashboard usa datos reales
// (dashboard-data.ts).
//
// Puntajes 0–100 (más alto es mejor) según docs/scoring-model.md; los valores son inventados.

import { gradeFor } from '@warden/shared';
import {
  DOMAIN_LABELS,
  type AssetRow,
  type CompanyOverview,
  type DashboardData,
  type DomainScoreRow,
  type ExposureOverview,
  type ReputationOverview,
  type SourceStatus,
  type FindingRow,
  type TrendPoint,
} from './dashboard-types';

const company: CompanyOverview = {
  id: 'c1',
  name: 'Empresa Ejemplo',
  primaryDomain: 'empresa-ejemplo.mx',
  score: 79.4,
  grade: 'C',
  previousScore: 78.2,
  lastScanAt: '2026-10-06T14:10:00Z',
  nextScanAt: '2026-10-13T14:00:00Z',
  openFindings: 12,
  openCriticalFindings: 1,
};

// Pesos de la versión 1 (supabase/seed.sql). El puntaje global es el promedio ponderado
// de los dominios con datos; secrets aparece sin datos para mostrar la cobertura parcial.
const domainScores: DomainScoreRow[] = [
  { key: 'exposure', name: DOMAIN_LABELS.exposure, weight: 25, score: 72.0, grade: 'C', findingsCount: 4, excluded: false },
  { key: 'email', name: DOMAIN_LABELS.email, weight: 15, score: 78.0, grade: 'C', findingsCount: 3, excluded: false },
  { key: 'certs', name: DOMAIN_LABELS.certs, weight: 10, score: 90.0, grade: 'A', findingsCount: 2, excluded: false },
  { key: 'secrets', name: DOMAIN_LABELS.secrets, weight: 20, score: null, grade: null, findingsCount: 1, excluded: true },
  { key: 'reputation', name: DOMAIN_LABELS.reputation, weight: 20, score: 92.0, grade: 'A', findingsCount: 1, excluded: false },
  { key: 'impersonation', name: DOMAIN_LABELS.impersonation, weight: 10, score: 64.0, grade: 'D', findingsCount: 2, excluded: false },
];

// Las IPs usan el rango de documentación 203.0.113.0/24 (RFC 5737).
const assets: AssetRow[] = [
  { id: 'a1', type: 'domain', value: 'empresa-ejemplo.mx', status: 'confirmed', discoverySource: 'manual', lastSeen: '2026-10-06T14:10:00Z' },
  { id: 'a2', type: 'subdomain', value: 'www.empresa-ejemplo.mx', status: 'confirmed', discoverySource: 'auto', lastSeen: '2026-10-06T14:10:00Z' },
  { id: 'a3', type: 'subdomain', value: 'mail.empresa-ejemplo.mx', status: 'confirmed', discoverySource: 'auto', lastSeen: '2026-10-06T14:10:00Z' },
  { id: 'a4', type: 'subdomain', value: 'vpn.empresa-ejemplo.mx', status: 'confirmed', discoverySource: 'auto', lastSeen: '2026-10-06T14:10:00Z' },
  { id: 'a5', type: 'subdomain', value: 'portal.empresa-ejemplo.mx', status: 'confirmed', discoverySource: 'auto', lastSeen: '2026-10-06T14:10:00Z' },
  { id: 'a6', type: 'ip_range', value: '203.0.113.0/28', status: 'confirmed', discoverySource: 'manual', lastSeen: '2026-10-06T14:10:00Z' },
  { id: 'a7', type: 'subdomain', value: 'staging.empresa-ejemplo.mx', status: 'pending', discoverySource: 'auto', lastSeen: '2026-10-06T14:10:00Z' },
  { id: 'a8', type: 'subdomain', value: 'dev-api.empresa-ejemplo.mx', status: 'pending', discoverySource: 'auto', lastSeen: '2026-09-29T14:05:00Z' },
  { id: 'a9', type: 'subdomain', value: 'tienda-old.empresa-ejemplo.mx', status: 'discarded', discoverySource: 'auto', lastSeen: '2026-08-18T13:50:00Z' },
];

const recentFindings: FindingRow[] = [
  { id: 'f1', indicator: 'RDP (3389) visible en 203.0.113.10', domain: 'exposure', severity: 'critical', confidence: 'high', source: 'SpiderFoot', observedAt: '2026-10-06T14:10:00Z' },
  { id: 'f2', indicator: 'Dominio parecido: empresa-ejemp1o.mx', domain: 'impersonation', severity: 'high', confidence: 'medium', source: 'typosquat', observedAt: '2026-10-06T14:10:00Z' },
  { id: 'f3', indicator: 'DMARC con política p=none', domain: 'email', severity: 'medium', confidence: 'high', source: 'DNS público', observedAt: '2026-10-06T14:10:00Z' },
  { id: 'f4', indicator: 'SSH (22) visible en vpn.empresa-ejemplo.mx', domain: 'exposure', severity: 'medium', confidence: 'medium', source: 'SpiderFoot', observedAt: '2026-09-29T14:05:00Z' },
  { id: 'f5', indicator: 'Certificado de portal.empresa-ejemplo.mx vence en 9 días', domain: 'certs', severity: 'low', confidence: 'high', source: 'crt.sh', observedAt: '2026-10-06T14:10:00Z' },
  { id: 'f6', indicator: 'SPF termina en ~all en lugar de -all', domain: 'email', severity: 'low', confidence: 'high', source: 'DNS público', observedAt: '2026-09-29T14:05:00Z' },
];

// KRI de los últimos 12 escaneos semanales.
const trend: TrendPoint[] = (
  [
    { scannedAt: '2026-07-21T14:00:00Z', score: 74.0 },
    { scannedAt: '2026-07-28T14:00:00Z', score: 74.8 },
    { scannedAt: '2026-08-04T14:00:00Z', score: 74.1 },
    { scannedAt: '2026-08-11T14:00:00Z', score: 75.9 },
    { scannedAt: '2026-08-18T14:00:00Z', score: 76.5 },
    { scannedAt: '2026-08-25T14:00:00Z', score: 76.0 },
    { scannedAt: '2026-09-01T14:00:00Z', score: 77.4 },
    { scannedAt: '2026-09-08T14:00:00Z', score: 77.9 },
    { scannedAt: '2026-09-15T14:00:00Z', score: 78.6 },
    { scannedAt: '2026-09-22T14:00:00Z', score: 78.2 },
    { scannedAt: '2026-09-29T14:05:00Z', score: 78.2 },
    { scannedAt: '2026-10-06T14:10:00Z', score: 79.4 },
  ] satisfies Omit<TrendPoint, 'grade'>[]
).map((p) => ({ ...p, grade: gradeFor(p.score) }));

const lastRun = (assetsReturned: number, findingsReturned: number) => ({
  status: 'ok' as const,
  assetsReturned,
  findingsReturned,
  itemsReturned: assetsReturned + findingsReturned,
  message: null,
  at: '2026-10-06T14:00:00Z',
});

const sources: SourceStatus[] = [
  { sourceKey: 'internetdb', name: 'Shodan InternetDB', riskDomain: 'exposure', enabled: true, lastRun: lastRun(3, 4) },
  { sourceKey: 'email_dns', name: 'DNS público (correo)', riskDomain: 'email', enabled: true, lastRun: lastRun(0, 2) },
  { sourceKey: 'abusech', name: 'abuse.ch', riskDomain: 'reputation', enabled: true, lastRun: lastRun(0, 1) },
  { sourceKey: 'crtsh', name: 'crt.sh', riskDomain: 'certs', enabled: true, lastRun: lastRun(6, 0) },
];

const exposure: ExposureOverview = {
  source: sources[0]!,
  cdnHosts: [{ ip: '198.51.100.20', provider: 'Imperva', resolvedFrom: ['www.empresa-ejemplo.mx'], portsObserved: 412 }],
  hosts: [
    {
      ip: '203.0.113.10',
      resolvedFrom: ['vpn.empresa-ejemplo.mx'],
      worstSeverity: 'critical',
      services: [
        { findingId: 'e1', port: 22, service: 'SSH', severity: 'info', confidence: 'high' },
        { findingId: 'e2', port: 3389, service: 'RDP', severity: 'critical', confidence: 'medium' },
      ],
      cves: [{ findingId: 'e3', cve: 'CVE-2019-0708', severity: 'critical', inKev: true, epss: 0.97 }],
      observedAt: '2026-10-06T14:10:00Z',
    },
    {
      ip: '203.0.113.4',
      resolvedFrom: ['empresa-ejemplo.mx', 'www.empresa-ejemplo.mx'],
      worstSeverity: 'high',
      services: [{ findingId: 'e4', port: 21, service: 'FTP', severity: 'high', confidence: 'medium' }],
      cves: [],
      observedAt: '2026-10-06T14:10:00Z',
    },
  ],
};

const reputation: ReputationOverview = {
  source: sources[2]!,
  subjects: [
    { subject: '203.0.113.4', type: 'ip', resolvedFrom: ['empresa-ejemplo.mx'], urlhausOnline: 0, urlhausTotal: 2, threatfoxIocs: 0, feodo: 0, blocklists: [] },
    { subject: 'empresa-ejemplo.mx', type: 'domain', resolvedFrom: [], urlhausOnline: 0, urlhausTotal: 0, threatfoxIocs: 0, feodo: null, blocklists: [] },
    { subject: 'vpn.empresa-ejemplo.mx', type: 'domain', resolvedFrom: [], urlhausOnline: 0, urlhausTotal: 0, threatfoxIocs: 0, feodo: null, blocklists: [] },
    { subject: '203.0.113.10', type: 'ip', resolvedFrom: ['vpn.empresa-ejemplo.mx'], urlhausOnline: 0, urlhausTotal: 0, threatfoxIocs: 0, feodo: 0, blocklists: [] },
  ],
  findings: [{ id: 'r1', title: '203.0.113.4 distribuyó malware (URLhaus, URLs ya inactivas)', severity: 'medium', subject: '203.0.113.4' }],
};

export const mockDashboard: DashboardData = {
  mode: 'mock',
  isAdmin: true,
  company,
  domains: domainScores,
  assets,
  recentFindings,
  trend,
  exposure,
  reputation,
  email: {
    source: sources[1]!,
    domains: [{
      domain: 'empresa-ejemplo.mx',
      spf: 'present',
      spfAllowsAll: false,
      dmarc: 'present',
      dmarcPolicy: 'none',
      mxCount: 2,
      nullMx: false,
    }],
    findings: [{ id: 'm1', title: 'DMARC de empresa-ejemplo.mx solo monitorea (p=none): no bloquea suplantación', severity: 'low' }],
  },
  sources,
  latestAlert: null,
  lastScan: {
    id: 's1',
    status: 'completed',
    createdAt: '2026-10-06T14:00:00Z',
    finishedAt: '2026-10-06T14:10:00Z',
    errorMessage: null,
    sourceFailures: false,
    startedAt: '2026-10-06T14:00:05Z',
    progress: { currentSource: null, done: 6, total: 6 },
  },
};
