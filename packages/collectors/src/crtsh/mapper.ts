import type { DiscoveredAsset } from '../types';

/** Una fila de https://crt.sh/?q=...&output=json (solo los campos usados). */
export interface CrtshEntry {
  id?: number;
  serial_number?: string;
  name_value: string;
  not_before: string;
  not_after: string;
  issuer_name: string;
}

/**
 * Extrae subdominios únicos del dominio evaluado. Descarta comodines y
 * nombres que no pertenecen al dominio (SAN de terceros).
 */
export function mapSubdomains(entries: CrtshEntry[], primaryDomain: string): DiscoveredAsset[] {
  const domain = primaryDomain.toLowerCase();
  const names = new Set<string>();

  for (const entry of entries) {
    for (const raw of entry.name_value.split('\n')) {
      const name = raw.trim().toLowerCase().replace(/^\*\./, '');
      if (name !== domain && name.endsWith(`.${domain}`)) names.add(name);
    }
  }

  return [...names].sort().map((value) => ({ type: 'subdomain', value }));
}
