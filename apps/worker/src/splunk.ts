import { config } from './config';
import { createHecSender, type SiemSender } from './pipeline/siem';

/**
 * Cliente de Splunk HEC de los eventos del SIEM. null si SPLUNK_HEC_URL no está configurado:
 * entonces tampoco se encolan eventos.
 */
export function createSplunkSender(): SiemSender | null {
  if (!config.SPLUNK_HEC_URL || !config.SPLUNK_HEC_TOKEN) return null;
  return createHecSender({ url: config.SPLUNK_HEC_URL, token: config.SPLUNK_HEC_TOKEN });
}
