import { dohLookup } from './resolver';

export const DNS_TYPES = { A: 1, NS: 2, MX: 15, CAA: 257 } as const;
export type DnsType = keyof typeof DNS_TYPES;

/** exists = false solo con NXDOMAIN: NOERROR sin registros del tipo pedido sigue siendo un nombre existente. */
export interface DohAnswer {
  exists: boolean;
  records: string[];
}

/**
 * Consulta un tipo de registro en el DNS público (DoH, con respaldo; ver resolver.ts): la
 * petición llega al resolvedor público, nunca a servidores de la empresa evaluada.
 * undefined = la consulta falló (SERVFAIL, truncada, red); no significa que el nombre no exista.
 */
export async function queryDoh(name: string, type: DnsType, signal: AbortSignal): Promise<DohAnswer | undefined> {
  const response = await dohLookup(name, type, signal);
  if (!response) return undefined;
  if (response.status === 3) return { exists: false, records: [] };
  // Las respuestas incluyen la cadena CNAME; solo interesan los registros del tipo pedido.
  const records = response.answers.filter((r) => r.type === DNS_TYPES[type]).map((r) => r.data.trim());
  return { exists: true, records };
}
