import { createHash } from 'node:crypto';
import type { Confidence, Severity } from '@warden/shared';
import { z } from 'zod';
import { fingerprint } from '../fingerprint';
import type { NormalizedFinding } from '../types';

export const SOURCE_KEY = 'gitleaks';

/** Una entrada del reporte JSON de gitleaks (solo los campos usados). */
export const gitleaksReportSchema = z.array(z.object({
  RuleID: z.string(),
  Description: z.string().optional().default(''),
  File: z.string(),
  StartLine: z.number().int(),
  Commit: z.string().optional().default(''),
  Date: z.string().optional().default(''),
  // Solo vive en memoria para deduplicar; nunca se guarda ni se registra.
  Secret: z.string(),
}));
export type GitleaksLeak = z.infer<typeof gitleaksReportSchema>[number];

/** Repositorio público de GitHub (`owner/name`). */
export interface ScannedRepo {
  fullName: string;
  leaks: GitleaksLeak[];
}

// SUPUESTO (pendiente de validar con el equipo): severidad por tipo de regla de gitleaks.
// Llaves privadas y de nube dan acceso directo a infraestructura; la regla genérica es
// ruidosa (ejemplos, valores de prueba). No se valida si el secreto sigue activo: hacerlo
// requeriría usarlo contra el proveedor.
function classify(ruleId: string): { severity: Severity; confidence: Confidence } {
  if (ruleId === 'generic-api-key') return { severity: 'medium', confidence: 'low' };
  if (/^(private-key|aws-|gcp-|azure-)/.test(ruleId)) return { severity: 'critical', confidence: 'medium' };
  return { severity: 'high', confidence: 'medium' };
}

/**
 * Un hallazgo por secreto distinto en cada repositorio: el mismo secreto repetido en varios
 * commits o archivos es una sola filtración. La huella usa un hash del secreto, no el valor.
 */
export function mapLeaks(repos: ScannedRepo[], observedAt: Date): NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];
  for (const repo of repos) {
    const groups = new Map<string, GitleaksLeak[]>();
    for (const leak of repo.leaks) {
      const secretHash = createHash('sha256').update(leak.Secret).digest('hex');
      const key = `${leak.RuleID}|${secretHash}`;
      groups.set(key, [...(groups.get(key) ?? []), leak]);
    }
    for (const [key, leaks] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      // Se muestra la aparición más reciente: es la que más urge rotar.
      const latest = [...leaks].sort((a, b) => b.Date.localeCompare(a.Date))[0]!;
      const { severity, confidence } = classify(latest.RuleID);
      const url = latest.Commit
        ? `https://github.com/${repo.fullName}/blob/${latest.Commit}/${latest.File.split('/').map(encodeURIComponent).join('/')}#L${latest.StartLine}`
        : null;
      findings.push({
        riskDomain: 'secrets',
        // Igual al activo code_org, que se guarda en minúsculas.
        assetValue: `github.com/${repo.fullName.split('/')[0]}`.toLowerCase(),
        fingerprint: fingerprint(SOURCE_KEY, `secrets.${latest.RuleID}`, `${repo.fullName}|${key.split('|')[1]}`),
        title: `${latest.Description || latest.RuleID} expuesto en github.com/${repo.fullName}`,
        severity,
        confidence,
        observedAt,
        // Sin el secreto, el fragmento ni el autor del commit (datos personales).
        evidence: {
          ruleId: latest.RuleID,
          repo: repo.fullName,
          file: latest.File,
          line: latest.StartLine,
          commit: latest.Commit,
          commitDate: latest.Date,
          url,
          occurrences: leaks.length,
          files: [...new Set(leaks.map((l) => l.File))].sort().slice(0, 20),
        },
      });
    }
  }
  return findings;
}
