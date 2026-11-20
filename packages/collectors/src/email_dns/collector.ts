import { emailModule } from '@warden/risk-analysis';
import type { Collector, CollectorResult, CollectorTarget } from '../types';
import { mapEmailAnalysis, SOURCE_KEY } from './mapper';
import { emailDnsProvider } from './provider';

const MAX_DOMAINS = 10;

/**
 * Dominios de correo a revisar: el principal y los activos confirmados de tipo `domain`.
 * `www.` es un host web, no un dominio de correo: se revisa el dominio sin ese prefijo.
 */
export function emailDomains(target: CollectorTarget): string[] {
  const names = [target.primaryDomain, ...target.assets.filter((a) => a.type === 'domain').map((a) => a.value)];
  return [...new Set(names.map((n) => n.toLowerCase().replace(/^www\./, '')))].slice(0, MAX_DOMAINS);
}

// Une el proveedor DNS (dns.google por DoH) con el analizador de @warden/risk-analysis.
// Solo lee registros publicados (SPF, DMARC, MX); no contacta servidores de la empresa.
// DKIM queda fuera: sin selectores conocidos no se puede inferir su ausencia.
export const emailDnsCollector: Collector = {
  sourceKey: SOURCE_KEY,
  riskDomain: 'email',
  isNoContact: true,

  async collect(target, ctx) {
    const result: Required<CollectorResult> = { assets: [], findings: [], notices: [] };
    const observedAt = new Date();

    for (const domain of emailDomains(target)) {
      ctx.signal.throwIfAborted();
      const analysisTarget = { primaryDomain: domain, confirmedDomains: [] };
      const evidence = await emailDnsProvider.collect(analysisTarget, ctx);
      const analysis = emailModule.analyze(evidence, analysisTarget);

      // Una consulta fallida no es ausencia del registro. Reportarla como 'ok' dejaría
      // que resolve.ts cerrara hallazgos abiertos que en realidad no se revisaron.
      const unknown = analysis.observations
        .filter((o) => /^email\.(spf|dmarc|mx)\.records$/.test(o.ruleId) && o.state === 'unknown')
        .map((o) => o.ruleId.split('.')[1]!.toUpperCase());
      if (unknown.length > 0) {
        throw new Error(`El DNS público (dns.google y Cloudflare) no respondió ${unknown.join(', ')} de ${domain}`);
      }

      const mapped = mapEmailAnalysis(analysis, observedAt);
      result.findings.push(...mapped.findings);
      result.notices.push(...mapped.notices);
    }
    return result;
  },
};
