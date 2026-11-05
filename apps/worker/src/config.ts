import { z } from 'zod';

/** Variable opcional: vacía en el .env cuenta como no definida. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => value === '' ? undefined : value, schema.optional());

const envSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().optional(),
  SPIDERFOOT_URL: z.url().optional(),
  HIBP_API_KEY: z.preprocess((value) => value === '' ? undefined : value,
    z.string().regex(/^[a-fA-F0-9]{32}$/).optional()),
  // abuse.ch no publica el formato de la Auth-Key; sin ella el colector abusech falla.
  ABUSECH_AUTH_KEY: z.preprocess((value) => value === '' ? undefined : value, z.string().trim().min(1).optional()),
  QUEUE_VISIBILITY_TIMEOUT: z.coerce.number().int().positive().default(900),
  // Envío de alertas por correo. Sin SMTP_HOST los envíos quedan pendientes (no se pierden).
  SMTP_HOST: optional(z.string().trim().min(1)),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // true solo para TLS implícito (puerto 465); en 587 se negocia STARTTLS.
  SMTP_SECURE: z.preprocess((value) => value === '' ? undefined : value, z.stringbool().default(false)),
  SMTP_USER: optional(z.string().min(1)),
  SMTP_PASSWORD: optional(z.string().min(1)),
  ALERT_EMAIL_FROM: optional(z.string().trim().min(3)),
  // URL pública de la web, para el enlace al reporte en el correo.
  WARDEN_WEB_URL: optional(z.url()),
}).refine((env) => !env.SMTP_HOST || env.ALERT_EMAIL_FROM, {
  message: 'Con SMTP_HOST definido falta ALERT_EMAIL_FROM (remitente de las alertas)',
  path: ['ALERT_EMAIL_FROM'],
});

export const config = envSchema.parse(process.env);
