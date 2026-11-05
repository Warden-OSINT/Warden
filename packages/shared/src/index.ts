// Valores compartidos entre web, worker y paquetes. Deben coincidir con los
// CHECK constraints y el seed de supabase/.

export const RISK_DOMAIN_KEYS = [
  'exposure',
  'email',
  'certs',
  'secrets',
  'reputation',
  'impersonation',
] as const;
export type RiskDomainKey = (typeof RISK_DOMAIN_KEYS)[number];

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type Grade = (typeof GRADES)[number];

/** Puntaje mínimo (0–100) de cada nota; por debajo de E es F (docs/scoring-model.md). */
export const GRADE_THRESHOLDS: readonly (readonly [Grade, number])[] = [['A', 90], ['B', 80], ['C', 70], ['D', 60], ['E', 50]];

export function gradeFor(score: number): Grade {
  return GRADE_THRESHOLDS.find(([, min]) => score >= min)?.[0] ?? 'F';
}

// code_org: organización o usuario de GitHub de la empresa (github.com/<nombre>); la usa gitleaks.
export const ASSET_TYPES = ['domain', 'subdomain', 'ip', 'ip_range', 'asn', 'code_org'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const FINDING_STATUSES = ['open', 'false_positive', 'accepted', 'resolved'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

// cancelled: un miembro lo detuvo (cancel_scan); no persiste resultados ni se califica.
export const SCAN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const SCAN_SOURCE_STATUSES = ['ok', 'failed', 'skipped', 'blocked'] as const;
export type ScanSourceStatus = (typeof SCAN_SOURCE_STATUSES)[number];

// grade_drop: la nota global bajó respecto al escaneo calificado anterior.
// threshold_crossed: la nota quedó por debajo del umbral de alert_settings.
export const ALERT_TYPES = ['grade_drop', 'threshold_crossed'] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

// in_app: la alerta tal como se ve en la web. Su envío por correo se registra aparte, en
// integration_outbox (destination = 'email'); webhook aún no tiene envío implementado.
export const ALERT_CHANNELS = ['email', 'webhook', 'in_app'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

// Deben coincidir con los CHECK de integration_outbox.
export const OUTBOX_DESTINATIONS = ['siem', 'soar', 'email'] as const;
export type OutboxDestination = (typeof OUTBOX_DESTINATIONS)[number];
export const OUTBOX_STATUSES = ['pending', 'sent', 'failed'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** true si `a` es peor nota que `b` (A es la mejor). */
export function isWorseGrade(a: Grade, b: Grade): boolean {
  return GRADES.indexOf(a) > GRADES.indexOf(b);
}

// pending: solicitado; draft: generado por la IA sin revisión humana; failed: no se pudo generar.
export const REPORT_STATUSES = ['pending', 'draft', 'validated', 'published', 'failed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const QUEUES = {
  scanRequests: 'scan_requests',
  reportRequests: 'report_requests',
} as const;

export interface ScanRequestMessage {
  scan_id: string;
}

export interface ReportRequestMessage {
  score_id: string;
}
