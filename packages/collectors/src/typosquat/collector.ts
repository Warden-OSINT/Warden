import { queryDoh, type DohAnswer } from '../dns/doh';
import type { Collector } from '../types';
import { generatePermutations, splitDomain } from './fuzz';
import { mapLookalikes, SOURCE_KEY, type RegisteredLookalike } from './mapper';

const MAX_PERMUTATIONS = 1500;
/** Detalle (MX/NS) solo de los primeros registrados: un nombre corto puede tener cientos. */
const MAX_REGISTERED_DETAIL = 150;
const CONCURRENCY = 8;
/**
 * Fallos de DNS tolerados. Un parecido no consultado deja de "observarse" y resolve.ts
 * podría cerrarlo, pero exige 3 escaneos exitosos seguidos sin verlo; más fallos que este
 * umbral hacen fallar la fuente para no contar el escaneo como exitoso.
 */
const MAX_FAILURE_RATIO = 0.05;

async function queryAll<T>(
  items: readonly T[],
  query: (item: T) => Promise<DohAnswer | undefined>,
  signal: AbortSignal,
  { failFast = false } = {},
) {
  const answers: (DohAnswer | undefined)[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    signal.throwIfAborted();
    const batch = await Promise.all(items.slice(i, i + CONCURRENCY).map(query));
    // Sin respuesta en todo el primer lote, ningún resolvedor DoH está accesible (red que los bloquea):
    // seguir costaría un timeout por consulta, varios minutos en total.
    if (failFast && i === 0 && batch.every((a) => a === undefined)) {
      throw new Error(`El DNS público (dns.google y Cloudflare) no respondió a las primeras ${batch.length} consultas; ¿la red bloquea DNS sobre HTTPS?`);
    }
    answers.push(...batch);
  }
  return answers;
}

// Genera dominios parecidos y los consulta en el DNS público (DoH: dns.google o Cloudflare). Nunca contacta al dominio
// evaluado ni a los parecidos (sin HTTP, banners ni SMTP): solo el resolvedor público.
export const typosquatCollector: Collector = {
  sourceKey: SOURCE_KEY,
  riskDomain: 'impersonation',
  isNoContact: true,

  async collect(target, ctx) {
    const { label, suffix } = splitDomain(target.primaryDomain);
    const domain = `${label}.${suffix}`;
    const permutations = generatePermutations(domain, MAX_PERMUTATIONS);

    let answers = await queryAll(permutations, (p) => queryDoh(p.domain, 'A', ctx.signal), ctx.signal, { failFast: true });
    // Un reintento para fallos transitorios del resolvedor.
    const retry = permutations.filter((_, i) => answers[i] === undefined);
    if (retry.length > 0) {
      const retried = await queryAll(retry, (p) => queryDoh(p.domain, 'A', ctx.signal), ctx.signal);
      const byDomain = new Map(retry.map((p, i) => [p.domain, retried[i]]));
      answers = answers.map((a, i) => a ?? byDomain.get(permutations[i]!.domain));
    }
    const failed = permutations.filter((_, i) => answers[i] === undefined).map((p) => p.domain);
    if (failed.length > permutations.length * MAX_FAILURE_RATIO) {
      throw new Error(`El DNS público (dns.google y Cloudflare) no respondió para ${failed.length} de ${permutations.length} dominios parecidos`);
    }

    const registered = permutations
      .map((p, i) => ({ ...p, a: answers[i] }))
      .filter((p): p is typeof p & { a: DohAnswer } => p.a?.exists === true);
    const detailed = registered.slice(0, MAX_REGISTERED_DETAIL);
    const [mx, ns, companyNs] = await Promise.all([
      queryAll(detailed, (p) => queryDoh(p.domain, 'MX', ctx.signal), ctx.signal),
      queryAll(detailed, (p) => queryDoh(p.domain, 'NS', ctx.signal), ctx.signal),
      queryDoh(domain, 'NS', ctx.signal),
    ]);

    const lookalikes: RegisteredLookalike[] = detailed.map((p, i) => ({
      domain: p.domain,
      fuzzer: p.fuzzer,
      a: p.a.records,
      mx: mx[i]?.records,
      ns: ns[i]?.records,
    }));
    const owned = new Set(target.assets.filter((a) => a.type === 'domain').map((a) => a.value.toLowerCase()));
    const { findings, notices } = mapLookalikes({
      domain,
      companyNs: companyNs?.records ?? [],
      lookalikes,
      owned,
      observedAt: new Date(),
    });

    notices.unshift({
      kind: 'observation',
      subject: domain,
      message: `${permutations.length} dominios parecidos consultados; ${registered.length} registrados`,
      details: {
        domain,
        generated: permutations.length,
        registered: registered.length,
        detailed: detailed.length,
        failed: failed.slice(0, 50),
      },
    });
    // Los parecidos no son activos de la empresa: no se devuelven como assets.
    return { assets: [], findings, notices };
  },
};
