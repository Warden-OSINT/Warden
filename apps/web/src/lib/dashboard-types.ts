// Formas que consumen los componentes del dashboard. Las llenan los datos reales
// (dashboard-data.ts) o los de ejemplo (mock-dashboard.ts) cuando no hay sesión en dev.
//
// El KRI y las notas son null hasta que el worker guarde el primer puntaje en `scores`
// (modelo en docs/scoring-model.md).

import type { ReportAlert } from './reports';
import type { AssetType, Confidence, Grade, RiskDomainKey, ScanSourceStatus, ScanStatus, Severity } from '@warden/shared';

export interface CompanyOverview {
  id: string;
  name: string;
  primaryDomain: string;
  score: number | null;
  grade: Grade | null;
  /** Puntaje del escaneo anterior, para mostrar la variación. */
  previousScore: number | null;
  lastScanAt: string | null;
  /** Próxima ejecución programada (schedules.next_run_at). */
  nextScanAt: string | null;
  openFindings: number;
  openCriticalFindings: number;
}

export type AttributionStatus = 'pending' | 'confirmed' | 'discarded';

export interface AssetRow {
  id: string;
  type: AssetType;
  value: string;
  status: AttributionStatus;
  discoverySource: 'auto' | 'manual';
  lastSeen: string;
}

export interface DomainScoreRow {
  key: RiskDomainKey;
  name: string;
  /** Peso en el KRI según la versión activa; null si no hay pesos definidos. */
  weight: number | null;
  score: number | null;
  grade: Grade | null;
  findingsCount: number;
  /** Sin datos en el último escaneo calificado: excluido del KRI y su peso repartido. */
  excluded: boolean;
}

export interface FindingRow {
  id: string;
  indicator: string;
  domain: RiskDomainKey;
  severity: Severity;
  confidence: Confidence;
  source: string;
  observedAt: string;
}

export interface TrendPoint {
  scannedAt: string;
  score: number;
  /** Nota guardada con el puntaje (scores.grade). */
  grade: Grade;
}

export interface ScanSummary {
  id: string;
  status: ScanStatus;
  createdAt: string;
  finishedAt: string | null;
  errorMessage: string | null;
  /** Alguna fuente falló o fue bloqueada aunque el escaneo haya terminado. */
  sourceFailures: boolean;
  startedAt: string | null;
  /** Avance mientras está en curso: fuente que se consulta y fuentes ya registradas. */
  progress: { currentSource: string | null; done: number; total: number | null };
}

/** Una fuente con colector implementado y su resultado en el último escaneo que la registró. */
export interface SourceStatus {
  sourceKey: string;
  name: string;
  riskDomain: RiskDomainKey | null;
  enabled: boolean;
  lastRun: {
    status: ScanSourceStatus;
    assetsReturned: number;
    findingsReturned: number;
    /** Total previo al desglose (filas antiguas). */
    itemsReturned: number;
    message: string | null;
    at: string;
  } | null;
}

export interface CdnHost {
  ip: string;
  provider: string | null;
  resolvedFrom: string[];
  portsObserved: number;
}

export interface ExposureService {
  findingId: string;
  port: number;
  service: string;
  severity: Severity;
  confidence: Confidence;
}

export interface ExposureCve {
  findingId: string;
  cve: string;
  severity: Severity;
  inKev: boolean;
  epss: number | null;
}

/** Hallazgos abiertos de exposición agrupados por IP. */
export interface ExposureHost {
  ip: string;
  /** Dominios confirmados que resolvieron a la IP. */
  resolvedFrom: string[];
  worstSeverity: Severity;
  services: ExposureService[];
  cves: ExposureCve[];
  observedAt: string;
}

export interface ExposureOverview {
  source: SourceStatus | null;
  hosts: ExposureHost[];
  /** IPs omitidas por pertenecer a un CDN en el último escaneo (scan_sources.notices). */
  cdnHosts: CdnHost[];
}

/** Estado de SPF/DMARC/MX de un dominio según la última corrida de email_dns. */
export interface EmailDomainStatus {
  domain: string;
  spf: 'present' | 'missing' | 'multiple' | 'unknown';
  spfAllowsAll: boolean;
  dmarc: 'present' | 'missing' | 'multiple' | 'unknown';
  /** none | quarantine | reject, o null si no hay una política reconocida. */
  dmarcPolicy: string | null;
  /** Registros MX publicados; null si no se pudo consultar. */
  mxCount: number | null;
  nullMx: boolean;
}

export interface EmailOverview {
  source: SourceStatus | null;
  domains: EmailDomainStatus[];
  findings: { id: string; title: string; severity: Severity }[];
}

/** Lo que abuse.ch reportó de un activo en la última corrida de abusech (scan_sources.notices). */
export interface ReputationSubjectStatus {
  subject: string;
  type: 'domain' | 'ip';
  /** Para IPs: dominios confirmados que resolvieron a ella. */
  resolvedFrom: string[];
  urlhausOnline: number;
  urlhausTotal: number;
  threatfoxIocs: number;
  /** null para dominios: Feodo Tracker solo lista IPs. */
  feodo: number | null;
  /** Listas (spamhaus_dbl, surbl) en las que URLhaus reporta el host. */
  blocklists: string[];
}

export interface ReputationOverview {
  source: SourceStatus | null;
  subjects: ReputationSubjectStatus[];
  findings: { id: string; title: string; severity: Severity; subject: string | null }[];
}

export interface DashboardData {
  /** 'mock' solo en desarrollo, sin sesión y con WARDEN_DEV_SKIP_AUTH. */
  mode: 'live' | 'mock';
  isAdmin: boolean;
  company: CompanyOverview;
  domains: DomainScoreRow[];
  assets: AssetRow[];
  recentFindings: FindingRow[];
  trend: TrendPoint[];
  exposure: ExposureOverview;
  email: EmailOverview;
  reputation: ReputationOverview;
  /** Fuentes con colector implementado, para habilitarlas y ver su último resultado. */
  sources: SourceStatus[];
  lastScan: ScanSummary | null;
  /** Alerta disparada por el último escaneo calificado; null si no hubo. */
  latestAlert: (ReportAlert & { scoreId: string }) | null;
}

export const DOMAIN_LABELS: Record<RiskDomainKey, string> = {
  exposure: 'Exposición de servicios',
  email: 'Seguridad de correo',
  certs: 'Certificados',
  secrets: 'Secretos filtrados',
  reputation: 'Reputación',
  impersonation: 'Suplantación',
};

// Explicaciones para personas sin formación en ciberseguridad (ayudas emergentes).
export const DOMAIN_DESCRIPTIONS: Record<RiskDomainKey, string> = {
  exposure: 'Servicios de la empresa visibles desde Internet (puertos abiertos) y vulnerabilidades conocidas en ellos. Cuantos menos y más actualizados, mejor.',
  email: 'Si el dominio publica SPF y DMARC, las reglas que impiden que otros envíen correos haciéndose pasar por la empresa.',
  certs: 'Certificados que protegen las conexiones (el candado del navegador): vencimientos, comodines y qué autoridades pueden emitirlos.',
  secrets: 'Contraseñas, llaves o tokens publicados por error en repositorios de código públicos de la empresa.',
  reputation: 'Si dominios o IPs de la empresa aparecen en listas de sitios con malware, phishing o botnets.',
  impersonation: 'Dominios con nombres parecidos al de la empresa registrados por terceros, que podrían usarse para engañar a clientes o empleados.',
};

export const SCORING_HELP = {
  kri: 'KRI (indicador clave de riesgo): calificación de 0 a 100 de la seguridad visible desde Internet. Más alto es mejor. A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, E ≥ 50 y F por debajo.',
  weight: 'Cuánto aporta este dominio al KRI global. Los pesos de una versión suman 100.',
  severityPoints: 'Cuánto resta del puntaje del dominio cada hallazgo abierto, según su severidad. Ejemplo: con Alta = 20, un solo hallazgo alto deja el dominio en ~72 de 100.',
  severityOrder: 'En orden: Crítica · Alta · Media · Baja · Info.',
  confidenceFactors: 'Qué tan seguro está Warden de cada hallazgo. Multiplica los puntos: 1 = cuenta completo, 0.5 = cuenta la mitad.',
  confidenceOrder: 'En orden: confianza Alta · Media · Baja.',
} as const;
