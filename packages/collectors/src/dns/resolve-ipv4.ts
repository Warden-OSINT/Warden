import { queryDoh } from './doh';

const MAX_NAMES = 200;
const CONCURRENCY = 4;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIpv4(value: string): boolean {
  return IPV4.test(value);
}

/** Descarta rangos privados y reservados: no son exposición pública ni tienen datos en fuentes OSINT. */
export function isPublicIpv4(value: string): boolean {
  if (!isIpv4(value)) return false;
  const [a = 0, b = 0] = value.split('.').map(Number);
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export interface ResolvedIps {
  /** IP pública → nombres que resolvieron a ella. */
  ips: Map<string, string[]>;
  /** Nombres cuya consulta falló: no significa que no resuelvan. */
  failed: string[];
}

/**
 * Resuelve registros A en el DNS público (DoH, con respaldo). La consulta llega al
 * resolvedor público, no a los servidores de la empresa evaluada.
 */
export async function resolveIpv4(names: readonly string[], signal: AbortSignal): Promise<ResolvedIps> {
  const unique = [...new Set(names.map((n) => n.toLowerCase()))].slice(0, MAX_NAMES);
  const ips = new Map<string, string[]>();
  const failed: string[] = [];

  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    signal.throwIfAborted();
    const batch = unique.slice(i, i + CONCURRENCY);
    const answers = await Promise.all(batch.map((name) => queryA(name, signal)));
    batch.forEach((name, index) => {
      const answer = answers[index];
      if (answer === undefined) {
        failed.push(name);
        return;
      }
      for (const ip of answer) {
        if (!isPublicIpv4(ip)) continue;
        const from = ips.get(ip) ?? [];
        if (!from.includes(name)) from.push(name);
        ips.set(ip, from);
      }
    });
  }

  return { ips, failed };
}

/** undefined = la consulta falló; [] = el nombre no tiene registros A. */
async function queryA(name: string, signal: AbortSignal): Promise<string[] | undefined> {
  return (await queryDoh(name, 'A', signal))?.records;
}
