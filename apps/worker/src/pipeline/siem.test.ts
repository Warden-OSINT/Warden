import { describe, expect, it } from 'vitest';
import { createHecSender, HecError, hecEndpoint, isRetryableStatus, toHecEvent, type HecEvent } from './siem';
import { buildAlertEvent, buildScoreEvent, countBySeverity, type SiemContext } from './siem-events';

const ctx: SiemContext = {
  occurredAt: '2026-11-18T18:00:00.000Z',
  company: { name: 'Empresa', primaryDomain: 'empresa.com' },
  scanId: 'scan-1',
  scoreId: 'score-1',
  webUrl: 'https://warden.empresa.com',
};

const score = {
  globalScore: 72.456,
  grade: 'C' as const,
  domains: [{ riskDomain: 'exposure' as const, score: 60.123, grade: 'D' as const, findingsCount: 3 }],
  excludedDomains: ['secrets' as const],
  openFindings: [
    { riskDomain: 'exposure' as const, severity: 'high' as const, confidence: 'high' as const, status: 'open' as const },
    { riskDomain: 'exposure' as const, severity: 'high' as const, confidence: 'medium' as const, status: 'open' as const },
    { riskDomain: 'email' as const, severity: 'low' as const, confidence: 'high' as const, status: 'open' as const },
  ],
};

describe('buildScoreEvent', () => {
  it('resume la calificación con conteos y enlace al reporte', () => {
    const event = buildScoreEvent(ctx, score, { previousGrade: 'B', weightsVersion: 1 });
    expect(event).toEqual({
      event_type: 'score',
      occurred_at: ctx.occurredAt,
      company: { name: 'Empresa', primary_domain: 'empresa.com' },
      score_id: 'score-1',
      report_url: 'https://warden.empresa.com/reports/score-1',
      scan_id: 'scan-1',
      global_score: 72.46,
      grade: 'C',
      previous_grade: 'B',
      weights_version: 1,
      domains: [{ key: 'exposure', score: 60.12, grade: 'D', open_findings: 3 }],
      excluded_domains: ['secrets'],
      open_findings: { critical: 0, high: 2, medium: 0, low: 1, info: 0 },
    });
  });

  it('sin WARDEN_WEB_URL no hay enlace', () => {
    expect(buildScoreEvent({ ...ctx, webUrl: null }, score, { previousGrade: null, weightsVersion: null }).report_url).toBeNull();
  });
});

describe('buildAlertEvent', () => {
  it('describe la alerta sin destinatarios de correo', () => {
    const event = buildAlertEvent(
      ctx,
      { type: 'threshold_crossed', previousGrade: 'B', alertId: 'alert-1', thresholdGrade: 'C' },
      score,
    );
    expect(event).toMatchObject({
      event_type: 'alert',
      alert_id: 'alert-1',
      alert_type: 'threshold_crossed',
      previous_grade: 'B',
      new_grade: 'C',
      threshold_grade: 'C',
      global_score: 72.46,
    });
    expect(JSON.stringify(event)).not.toContain('recipients');
  });
});

describe('countBySeverity', () => {
  it('incluye todas las severidades aunque estén en cero', () => {
    expect(countBySeverity([])).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
  });
});

describe('toHecEvent', () => {
  const payload = buildScoreEvent(ctx, score, { previousGrade: null, weightsVersion: 1 });

  it('usa el sourcetype por tipo, el epoch del evento y el id del outbox como event_id', () => {
    const event = toHecEvent({ id: 42, payload }, 'warden');
    expect(event).toMatchObject({ time: 1_795_024_800, sourcetype: 'warden:score', source: 'warden', index: 'warden' });
    expect(event.event).toMatchObject({ event_id: 42, grade: 'C' });
  });

  it('omite el índice si no se configura', () => {
    expect(toHecEvent({ id: 1, payload }, null)).not.toHaveProperty('index');
  });

  it('rechaza payloads que no son eventos del SIEM', () => {
    expect(() => toHecEvent({ id: 1, payload: { recipients: ['a@empresa.com'] } }, null)).toThrow();
  });
});

describe('HEC', () => {
  it('arma el endpoint desde la URL base o completa', () => {
    expect(hecEndpoint('https://splunk.empresa.com:8088')).toBe('https://splunk.empresa.com:8088/services/collector/event');
    expect(hecEndpoint('https://splunk.empresa.com:8088/services/collector/event')).toBe('https://splunk.empresa.com:8088/services/collector/event');
  });

  it('no reintenta eventos inválidos o demasiado grandes', () => {
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(413)).toBe(false);
    expect(isRetryableStatus(403)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  const event: HecEvent = { time: 1, host: 'warden', source: 'warden', sourcetype: 'warden:score', event: { event_id: 1 } };

  it('manda el token en el header y el evento como JSON', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const sender = createHecSender({
      url: 'http://127.0.0.1:8088',
      token: 'tok',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Response('{"text":"Success","code":0}', { status: 200 });
      },
    });
    await sender.send(event);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8088/services/collector/event');
    expect(calls[0]?.init.headers).toMatchObject({ Authorization: 'Splunk tok' });
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(event);
  });

  it('clasifica los errores de HEC', async () => {
    const reject = createHecSender({ url: 'http://x:8088', token: 't', fetch: async () => new Response('{"code":6}', { status: 400 }) });
    await expect(reject.send(event)).rejects.toMatchObject({ retryable: false });

    const down = createHecSender({ url: 'http://x:8088', token: 't', fetch: async () => { throw new TypeError('fetch failed'); } });
    await expect(down.send(event)).rejects.toBeInstanceOf(HecError);
    await expect(down.send(event)).rejects.toMatchObject({ retryable: true });
  });
});
