import { createHash } from 'node:crypto';
import { chatCompletion } from './client';
import { buildMessages, PROMPT_VERSION, type ExecutiveSummaryContext } from './prompts/executive-summary.v1';
import { redact } from './redact';
import { executiveSummarySchema, type ExecutiveSummary } from './schemas';

export { chatCompletion, type ChatMessage } from './client';
export { redact } from './redact';
export type { ExecutiveSummary, ExecutiveSummaryContext };

export interface GeneratedSummary {
  summary: ExecutiveSummary;
  modelUsed: string;
  promptVersion: string;
  /** Hash del contexto enviado; permite detectar reportes generados con los mismos datos. */
  contextHash: string;
}

/**
 * JSON de la respuesta del modelo. Aunque se pida JSON puro, algunos modelos lo envuelven en
 * un bloque ```json o agregan texto antes; se toma el primer objeto completo.
 */
export function parseModelJson(content: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content)?.[1];
  const text = (fenced ?? content).trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new Error('La IA no devolvió JSON');
    return JSON.parse(text.slice(start, end + 1));
  }
}

export async function generateExecutiveSummary(
  ctx: ExecutiveSummaryContext,
  opts: { apiKey: string; model: string; signal?: AbortSignal },
): Promise<GeneratedSummary> {
  const safeCtx = JSON.parse(redact(JSON.stringify(ctx))) as ExecutiveSummaryContext;
  const contextHash = createHash('sha256').update(JSON.stringify(safeCtx)).digest('hex');

  const res = await chatCompletion({
    apiKey: opts.apiKey,
    model: opts.model,
    messages: buildMessages(safeCtx),
    jsonMode: true,
    signal: opts.signal,
  });

  const summary = executiveSummarySchema.parse(parseModelJson(res.content));
  return { summary, modelUsed: res.model, promptVersion: PROMPT_VERSION, contextHash };
}
