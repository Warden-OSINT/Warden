import type { AssetType, Confidence, RiskDomainKey, Severity } from '@warden/shared';

export interface CollectorTarget {
  companyId: string;
  primaryDomain: string;
  /** Solo activos con attribution_status = 'confirmed'. */
  assets: { type: AssetType; value: string }[];
}

export interface CollectorContext {
  signal: AbortSignal;
  /** Resuelve el secreto de una fuente a partir de source_credentials.secret_ref. */
  getSecret(secretRef: string): string | undefined;
}

export interface DiscoveredAsset {
  type: AssetType;
  value: string;
}

export interface NormalizedFinding {
  riskDomain: RiskDomainKey;
  /** Valor del activo afectado; se resuelve a asset_id al persistir. */
  assetValue?: string;
  /** Estable entre escaneos: es la clave de deduplicación (ver fingerprint.ts). */
  fingerprint: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  observedAt: Date;
  evidence: Record<string, unknown>;
  rawReference?: unknown;
}

/**
 * Algo que el colector observó pero que no es un hallazgo, para explicar un resultado
 * (p. ej. una IP omitida por ser de un CDN). Se guarda en scan_sources.notices.
 */
export interface CollectorNotice {
  /** cdn: IP omitida por ser de un CDN. observation: estado observado (p. ej. SPF publicado). */
  kind: 'cdn' | 'observation';
  /** Valor afectado, p. ej. la IP. */
  subject: string;
  message: string;
  /** Debe ser serializable a JSON. */
  details: Record<string, unknown>;
}

export interface CollectorResult {
  assets: DiscoveredAsset[];
  findings: NormalizedFinding[];
  notices?: CollectorNotice[];
}

export interface Collector {
  /** Igual a sources.source_key y al nombre de la carpeta del colector. */
  sourceKey: string;
  riskDomain: RiskDomainKey;
  /**
   * Tipo literal `true`: un colector que contacte la infraestructura evaluada
   * no compila. La BD aplica la misma regla con sources.is_no_contact.
   */
  isNoContact: true;
  collect(target: CollectorTarget, ctx: CollectorContext): Promise<CollectorResult>;
}
