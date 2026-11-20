import type { AlertType, Grade } from '@warden/shared';

export interface AlertEmailContext {
  companyName: string;
  primaryDomain: string;
  type: AlertType;
  previousGrade: Grade | null;
  newGrade: Grade;
  globalScore: number;
  /** Umbral vigente al registrar la alerta (solo threshold_crossed). */
  thresholdGrade: Grade | null;
  computedAt: string;
  /** null si WARDEN_WEB_URL no está configurada. */
  reportUrl: string | null;
}

export interface AlertEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Misma zona que la web (components/dashboard/format.ts): CST, sin horario de verano desde 2022.
const dateFormat = new Intl.DateTimeFormat('es', {
  day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Mexico_City',
});

function headline(ctx: AlertEmailContext): string {
  if (ctx.type === 'threshold_crossed') {
    return `La nota de ${ctx.companyName} quedó en ${ctx.newGrade}, por debajo del umbral ${ctx.thresholdGrade ?? '—'}`;
  }
  return `La nota de ${ctx.companyName} bajó de ${ctx.previousGrade ?? '—'} a ${ctx.newGrade}`;
}

/**
 * Correo de una alerta. Solo lleva notas, el KRI y un enlace al reporte: nunca evidencia
 * (secretos, correos, IPs), que se consulta en Warden con sesión.
 */
export function buildAlertEmail(ctx: AlertEmailContext): AlertEmail {
  const title = headline(ctx);
  const when = `${dateFormat.format(new Date(ctx.computedAt))} CST`;
  const change = ctx.previousGrade ? `${ctx.previousGrade} → ${ctx.newGrade}` : ctx.newGrade;
  const lines = [
    title,
    '',
    `Dominio evaluado: ${ctx.primaryDomain}`,
    `Nota: ${change} (KRI ${ctx.globalScore.toFixed(1)} de 100)`,
    `Calificado: ${when}`,
    '',
    ctx.reportUrl ? `Ver el reporte completo: ${ctx.reportUrl}` : 'Consulta el reporte completo en Warden.',
    '',
    'Este aviso lo envía Warden automáticamente al calificar un escaneo. Los destinatarios se configuran en Configuración → Alertas.',
  ];

  const link = ctx.reportUrl
    ? `<p><a href="${escapeHtml(ctx.reportUrl)}">Ver el reporte completo</a></p>`
    : '<p>Consulta el reporte completo en Warden.</p>';
  const html = [
    `<h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>`,
    '<table cellpadding="4" style="border-collapse:collapse">',
    `<tr><td>Dominio evaluado</td><td><strong>${escapeHtml(ctx.primaryDomain)}</strong></td></tr>`,
    `<tr><td>Nota</td><td><strong>${escapeHtml(change)}</strong> (KRI ${ctx.globalScore.toFixed(1)} de 100)</td></tr>`,
    `<tr><td>Calificado</td><td>${escapeHtml(when)}</td></tr>`,
    '</table>',
    link,
    '<p style="color:#666;font-size:12px">Este aviso lo envía Warden automáticamente al calificar un escaneo. Los destinatarios se configuran en Configuración → Alertas.</p>',
  ].join('\n');

  return { subject: `[Warden] ${title}`, text: lines.join('\n'), html };
}
