import type { Confidence, Severity } from '@warden/shared';
import { z } from 'zod';
import { fingerprint } from '../fingerprint';
import type { CollectorNotice, NormalizedFinding } from '../types';
import { cveSeverity, EMPTY_ENRICHMENT, type CveEnrichment } from './cve-enrichment';

export const SOURCE_KEY = 'internetdb';
const ATTRIBUTION = 'Shodan InternetDB — https://internetdb.shodan.io';

/** Respuesta de https://internetdb.shodan.io/{ip}. */
export const internetDbHostSchema = z.object({
  ip: z.string(),
  ports: z.array(z.number().int().min(0).max(65535)),
  cpes: z.array(z.string()).default([]),
  hostnames: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  vulns: z.array(z.string()).default([]),
});
export type InternetDbHost = z.infer<typeof internetDbHostSchema>;

export interface ObservedHost {
  ip: string;
  /** Activos confirmados que resolvieron a esta IP (vacío si la IP está confirmada directamente). */
  resolvedFrom: string[];
  /** null = InternetDB no tiene datos de la IP (404). */
  data: InternetDbHost | null;
}

interface PortRule {
  ruleId: string;
  service: string;
  severity: Severity;
  /** Fragmentos de CPE que confirman el producto; InternetDB solo da números de puerto. */
  cpeHints: string[];
}

const rule = (ruleId: string, service: string, severity: Severity, cpeHints: string[] = []): PortRule =>
  ({ ruleId, service, severity, cpeHints });

// SUPUESTO (pendiente de validar con el equipo): severidad por servicio expuesto.
// Es la severidad del hallazgo, no el modelo de scoring del KRI (docs/scoring-model.md).
const PORT_RULES: ReadonlyMap<number, PortRule> = new Map([
  // Acceso remoto y administración de infraestructura.
  [3389, rule('exposure.port.rdp', 'RDP', 'critical', ['remote_desktop', 'terminal_services'])],
  [445, rule('exposure.port.smb', 'SMB', 'critical', ['samba', 'windows'])],
  [5985, rule('exposure.port.winrm', 'WinRM', 'critical', ['windows_remote_management'])],
  [5986, rule('exposure.port.winrm', 'WinRM', 'critical', ['windows_remote_management'])],
  [6443, rule('exposure.port.kubernetes', 'Kubernetes API', 'critical', ['kubernetes'])],
  [10250, rule('exposure.port.kubernetes', 'kubelet', 'critical', ['kubernetes'])],
  [2379, rule('exposure.port.etcd', 'etcd', 'critical', ['etcd'])],
  [2375, rule('exposure.port.docker', 'Docker API', 'high', ['docker'])],
  [5900, rule('exposure.port.vnc', 'VNC', 'high', ['vnc'])],
  // Protocolos sin cifrado o de red interna.
  [23, rule('exposure.port.telnet', 'Telnet', 'high', ['telnet'])],
  [21, rule('exposure.port.ftp', 'FTP', 'high', ['ftp'])],
  [139, rule('exposure.port.netbios', 'NetBIOS', 'high', ['samba', 'windows'])],
  [161, rule('exposure.port.snmp', 'SNMP', 'high', ['snmp'])],
  [389, rule('exposure.port.ldap', 'LDAP', 'high', ['ldap', 'active_directory'])],
  [873, rule('exposure.port.rsync', 'rsync', 'high', ['rsync'])],
  // Almacenes que con frecuencia se despliegan sin autenticación.
  [6379, rule('exposure.port.database', 'Redis', 'critical', ['redis'])],
  [27017, rule('exposure.port.database', 'MongoDB', 'critical', ['mongodb'])],
  [9200, rule('exposure.port.database', 'Elasticsearch', 'critical', ['elasticsearch'])],
  [11211, rule('exposure.port.database', 'Memcached', 'critical', ['memcached'])],
  // Bases de datos con autenticación por defecto.
  [3306, rule('exposure.port.database', 'MySQL', 'high', ['mysql', 'mariadb'])],
  [5432, rule('exposure.port.database', 'PostgreSQL', 'high', ['postgresql'])],
  [1433, rule('exposure.port.database', 'SQL Server', 'high', ['sql_server'])],
  [1521, rule('exposure.port.database', 'Oracle', 'high', ['oracle:database'])],
  [5984, rule('exposure.port.database', 'CouchDB', 'high', ['couchdb'])],
  [9042, rule('exposure.port.database', 'Cassandra', 'high', ['cassandra'])],
  [9092, rule('exposure.port.kafka', 'Kafka', 'high', ['kafka'])],
  // Consolas de administración.
  [5601, rule('exposure.port.admin-console', 'Kibana', 'high', ['kibana'])],
  [15672, rule('exposure.port.admin-console', 'RabbitMQ', 'high', ['rabbitmq'])],
  // Esperado en la mayoría de servidores; queda como inventario.
  [22, rule('exposure.port.ssh', 'SSH', 'info', ['openssh', 'ssh'])],
]);
const DEFAULT_RULE = rule('exposure.port.open', 'desconocido', 'info');
// HTTP/HTTPS están en casi todas las IPs: como hallazgo solo agregan ruido.
const IGNORED_PORTS: ReadonlySet<number> = new Set([80, 443]);

/**
 * Convierte los datos de InternetDB en hallazgos del dominio `exposure`.
 * Las IPs etiquetadas como CDN se omiten: sus puertos y CVE son del proveedor, no de la empresa.
 */
export function mapExposure(
  hosts: readonly ObservedHost[],
  observedAt: Date,
  enrichment: CveEnrichment = EMPTY_ENRICHMENT,
): NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];

  for (const { ip, resolvedFrom, data } of hosts) {
    if (!data || data.tags.includes('cdn')) continue;
    const context = { ip, resolvedFrom, tags: data.tags, attribution: ATTRIBUTION };
    const cpes = data.cpes.map((c) => c.toLowerCase());

    for (const port of [...new Set(data.ports)].sort((a, b) => a - b)) {
      if (IGNORED_PORTS.has(port)) continue;
      const portRule = PORT_RULES.get(port) ?? DEFAULT_RULE;
      // Los CPE son de la IP, no del puerto, pero confirman que el producto está presente.
      const serviceConfirmed = portRule.cpeHints.some((hint) => cpes.some((cpe) => cpe.includes(hint)));
      // Sin CPE el servicio se deduce del puerto; datos con actualización semanal.
      const confidence: Confidence = serviceConfirmed ? 'high' : 'medium';
      findings.push({
        riskDomain: 'exposure',
        assetValue: ip,
        fingerprint: fingerprint(SOURCE_KEY, portRule.ruleId, `${ip}:${port}`),
        title: portRule === DEFAULT_RULE
          ? `Puerto ${port} abierto en ${ip}`
          : `Servicio ${portRule.service} expuesto en ${ip}:${port}`,
        severity: portRule.severity,
        confidence,
        observedAt,
        evidence: {
          ...context,
          port,
          service: portRule.service,
          serviceInferredFrom: serviceConfirmed ? 'cpe' : 'port',
          cpes: data.cpes,
        },
      });
    }

    for (const cve of [...new Set(data.vulns)].sort()) {
      findings.push({
        riskDomain: 'exposure',
        assetValue: ip,
        fingerprint: fingerprint(SOURCE_KEY, 'exposure.cve', `${ip}:${cve}`),
        title: `Posible vulnerabilidad ${cve} en ${ip}`,
        severity: cveSeverity(cve, enrichment),
        // InternetDB infiere CVE por versión de software, sin verificar explotabilidad.
        confidence: 'low',
        observedAt,
        evidence: {
          ...context,
          cve,
          cpes: data.cpes,
          inKev: enrichment.kev.has(cve),
          epss: enrichment.epss.get(cve) ?? null,
        },
      });
    }
  }

  return findings;
}

/**
 * Avisos de las IPs que mapExposure omite por estar etiquetadas como CDN: sin ellos un
 * escaneo así parece vacío. El proveedor sale de los CPE cuando InternetDB lo reporta.
 */
export function cdnNotices(hosts: readonly ObservedHost[]): CollectorNotice[] {
  return hosts.flatMap(({ ip, resolvedFrom, data }) => {
    if (!data?.tags.includes('cdn')) return [];
    const provider = cdnProvider(data.cpes);
    return [{
      kind: 'cdn' as const,
      subject: ip,
      message: `${ip} pertenece a un CDN${provider ? ` (${provider})` : ''}: sus puertos y CVE son del proveedor, no se atribuyen a la empresa`,
      details: {
        ip,
        provider,
        resolvedFrom,
        portsObserved: new Set(data.ports).size,
        sharedHostnames: data.hostnames.length,
        attribution: ATTRIBUTION,
      },
    }];
  });
}

// Proveedores de CDN/WAF frecuentes, reconocibles por su CPE en InternetDB.
const CDN_CPES: ReadonlyArray<[string, string]> = [
  ['imperva', 'Imperva'],
  ['incapsula', 'Imperva'],
  ['cloudflare', 'Cloudflare'],
  ['akamai', 'Akamai'],
  ['fastly', 'Fastly'],
  ['amazon:cloudfront', 'Amazon CloudFront'],
  ['azure', 'Azure Front Door'],
  ['sucuri', 'Sucuri'],
];

function cdnProvider(cpes: readonly string[]): string | null {
  const lower = cpes.map((c) => c.toLowerCase());
  return CDN_CPES.find(([hint]) => lower.some((c) => c.includes(hint)))?.[1] ?? null;
}
