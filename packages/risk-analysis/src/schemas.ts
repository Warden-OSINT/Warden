import { z } from 'zod';

export const domainSchema = z.string().trim().toLowerCase().transform((v) => v.replace(/\.$/, ''))
  .pipe(z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/));

export const evidenceEnvelope = {
  schemaVersion: z.literal(1),
  // Igual que el CHECK de sources.source_key en la BD.
  sourceKey: z.string().regex(/^[a-z0-9_]{1,64}$/),
  subjectDomain: domainSchema,
  observedAt: z.iso.datetime(),
};

export const dnsObservationSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('ok'), records: z.array(z.string().max(4096)).max(100) }),
  z.strictObject({ status: z.literal('unavailable') }),
]);
