import { generateExecutiveSummary, type ExecutiveSummaryContext } from '@warden/ai';
import { SEVERITIES, type Severity } from '@warden/shared';
import { config } from '../config';
import type { Db } from '../supabase';

/** Hallazgos que se envían a la IA: los más severos bastan para un resumen ejecutivo. */
export const TOP_FINDINGS = 15;
const MAX_ERROR_LENGTH = 500;

export interface ReportSource {
  companyName: string;
  globalScore: number;
  grade: string;
  domains: { name: string; grade: string; findingsCount: number }[];
  /** Dominios sin datos en el escaneo (excluidos del KRI). */
  excludedDomains: string[];
  openFindings: { title: string; severity: string; domain: string }[];
}

const severityRank = (s: string) => {
  const i = SEVERITIES.indexOf(s as Severity);
  return i === -1 ? SEVERITIES.length : i;
};

/**
 * Contexto del prompt executive-summary.v1. Solo títulos de hallazgos, nunca la evidencia
 * (secretos, correos): además, generateExecutiveSummary aplica redact() antes de enviarlo.
 */
export function buildReportContext(src: ReportSource): ExecutiveSummaryContext {
  return {
    companyName: src.companyName,
    grade: src.grade,
    globalScore: src.globalScore,
    // Los dominios sin datos van con "sin datos" para que el resumen no los dé por seguros.
    domains: [
      ...src.domains,
      ...src.excludedDomains.map((name) => ({ name, grade: 'sin datos', findingsCount: 0 })),
    ],
    topFindings: [...src.openFindings]
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.title.localeCompare(b.title))
      .filter((f) => f.severity !== 'info')
      .slice(0, TOP_FINDINGS),
  };
}

/** Genera y guarda el resumen de un puntaje. Nunca lanza: un fallo queda en reports.status = 'failed'. */
export async function generateReport(db: Db, scoreId: string, signal: AbortSignal): Promise<void> {
  try {
    if (!config.OPENROUTER_API_KEY || !config.OPENROUTER_MODEL) {
      throw new Error('Falta OPENROUTER_API_KEY u OPENROUTER_MODEL en el .env del worker');
    }
    const source = await loadReportSource(db, scoreId);
    const generated = await generateExecutiveSummary(buildReportContext(source), {
      apiKey: config.OPENROUTER_API_KEY,
      model: config.OPENROUTER_MODEL,
      signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
    });
    const { error } = await db
      .from('reports')
      .upsert(
        {
          score_id: scoreId,
          status: 'draft',
          summary_text: generated.summary.summary,
          content: generated.summary,
          model_used: generated.modelUsed,
          prompt_version: generated.promptVersion,
          context_hash: generated.contextHash,
          generated_at: new Date().toISOString(),
          error_message: null,
        },
        { onConflict: 'score_id' },
      );
    if (error) throw error;
    console.log(`[report] ${scoreId} resumen generado con ${generated.modelUsed}`);
  } catch (err) {
    if (signal.aborted) throw err;
    const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LENGTH);
    console.error(`[report] ${scoreId} falló`, message);
    await db
      .from('reports')
      .upsert({ score_id: scoreId, status: 'failed', error_message: message }, { onConflict: 'score_id' });
  }
}

async function loadReportSource(db: Db, scoreId: string): Promise<ReportSource> {
  const { data: score, error } = await db
    .from('scores')
    .select('company_id, global_score, grade, excluded_domains, companies!inner(name), score_domains(grade, findings_count, risk_domains!inner(name))')
    .eq('id', scoreId)
    .single();
  if (error) throw error;

  // Una consulta por severidad: con un límite global, un subconjunto arbitrario podría dejar
  // fuera los críticos. 'info' nunca entra al resumen (ver buildReportContext).
  const severities = SEVERITIES.filter((s) => s !== 'info');
  const [domainsRes, ...findingsRes] = await Promise.all([
    db.from('risk_domains').select('key, name'),
    ...severities.map((severity) =>
      db
        .from('findings')
        .select('title, severity, risk_domains!inner(name)')
        .eq('company_id', score.company_id)
        .eq('status', 'open')
        .eq('severity', severity)
        .order('title')
        .limit(TOP_FINDINGS)),
  ]);
  if (domainsRes.error) throw domainsRes.error;
  const findings = findingsRes.flatMap((res) => {
    if (res.error) throw res.error;
    return res.data;
  });
  const domains = domainsRes.data;
  const domainName = new Map(domains.map((d) => [d.key, d.name]));

  return {
    companyName: score.companies.name,
    globalScore: Number(score.global_score),
    grade: score.grade.trim(),
    domains: score.score_domains.map((d) => ({
      name: d.risk_domains.name,
      grade: d.grade.trim(),
      findingsCount: d.findings_count,
    })),
    excludedDomains: score.excluded_domains.map((key) => domainName.get(key) ?? key),
    openFindings: findings.map((f) => ({ title: f.title, severity: f.severity, domain: f.risk_domains.name })),
  };
}
