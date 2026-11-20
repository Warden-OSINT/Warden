import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { fetchPublicJson } from '../http/public-json';
import type { Collector, CollectorNotice } from '../types';
import { gitleaksReportSchema, mapLeaks, SOURCE_KEY, type GitleaksLeak, type ScannedRepo } from './mapper';

const run = promisify(execFile);

const MAX_REPOS = 20;
/** Tamaño reportado por GitHub, en KB. Repos más grandes no caben en el timeout de la cola. */
const MAX_REPO_SIZE_KB = 200_000;
const STEP_TIMEOUT_MS = 120_000;
const ORG = /^github\.com\/([a-z0-9](?:[a-z0-9-]{0,38}))$/i;
const REPO_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9._-]{1,100}$/;

const reposSchema = z.array(z.object({
  full_name: z.string().regex(REPO_NAME),
  private: z.boolean(),
  fork: z.boolean(),
  size: z.number(),
}));

export interface GitleaksDeps {
  /** Repos públicos de un dueño de GitHub (organización o usuario). */
  listRepos(owner: string, signal: AbortSignal): Promise<z.infer<typeof reposSchema>>;
  /** Clona y escanea un repo; lanza si algo falla. */
  scanRepo(fullName: string, signal: AbortSignal): Promise<GitleaksLeak[]>;
}

async function listRepos(owner: string, signal: AbortSignal) {
  const repos: z.infer<typeof reposSchema> = [];
  // /users/ sirve también para organizaciones y solo devuelve repos públicos sin token.
  for (let page = 1; page <= 3; page++) {
    const url = new URL(`https://api.github.com/users/${encodeURIComponent(owner)}/repos`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const batch = reposSchema.parse(await fetchPublicJson(url, signal, { accept: 'application/vnd.github+json' }));
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

async function scanRepo(fullName: string, signal: AbortSignal): Promise<GitleaksLeak[]> {
  if (!REPO_NAME.test(fullName)) throw new Error(`Nombre de repositorio inválido: ${fullName}`);
  const dir = await mkdtemp(join(tmpdir(), 'warden-gitleaks-'));
  // Sin credenciales, prompts, hooks de LFS ni redirects: solo HTTPS público hacia github.com.
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1', GIT_CONFIG_NOSYSTEM: '1' };
  try {
    await run('git', [
      '-c', 'credential.helper=', '-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always',
      '-c', 'http.followRedirects=false',
      'clone', '--quiet', '--no-checkout', '--single-branch', '--no-tags',
      `https://github.com/${fullName}.git`, join(dir, 'repo'),
    ], { env, signal, timeout: STEP_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    const report = join(dir, 'report.json');
    // Historial completo de la rama principal; --exit-code 0 porque encontrar secretos no es un error.
    await run('gitleaks', [
      'git', join(dir, 'repo'), '--report-format', 'json', '--report-path', report,
      '--no-banner', '--log-level', 'error', '--exit-code', '0',
    ], { env, signal, timeout: STEP_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
    const text = (await readFile(report, 'utf8')).trim();
    return gitleaksReportSchema.parse(text ? JSON.parse(text) : []);
  } finally {
    // El clon y el reporte contienen los secretos en claro.
    await rm(dir, { recursive: true, force: true });
  }
}

export function createGitleaksCollector(deps: GitleaksDeps = { listRepos, scanRepo }): Collector {
  return {
    sourceKey: SOURCE_KEY,
    riskDomain: 'secrets',
    isNoContact: true,

    async collect(target, ctx) {
      const notices: CollectorNotice[] = [];
      const owners: string[] = [];
      for (const asset of target.assets.filter((a) => a.type === 'code_org')) {
        const owner = ORG.exec(asset.value)?.[1];
        if (owner) owners.push(owner);
        else notices.push({ kind: 'observation', subject: asset.value, message: `Solo se admiten organizaciones de github.com: ${asset.value}`, details: { value: asset.value } });
      }
      // Sin repos que revisar no hay datos de `secrets`: un 'ok' calificaría el dominio con 100.
      if (owners.length === 0) {
        throw new Error('Sin organizaciones de código (github.com/<org>) confirmadas en Activos: no hay repositorios que revisar');
      }

      const candidates = [];
      for (const owner of owners) {
        for (const repo of await deps.listRepos(owner, ctx.signal)) {
          // Un fork trae los secretos del proyecto original, que no es de la empresa.
          if (repo.private || repo.fork) continue;
          if (repo.size > MAX_REPO_SIZE_KB) {
            notices.push({ kind: 'observation', subject: repo.full_name,
              message: `${repo.full_name} omitido: ${Math.round(repo.size / 1024)} MB excede el límite`, details: { sizeKb: repo.size } });
            continue;
          }
          candidates.push(repo.full_name);
        }
      }
      const selected = candidates.sort().slice(0, MAX_REPOS);
      if (candidates.length > selected.length) {
        notices.push({ kind: 'observation', subject: target.primaryDomain,
          message: `Se revisaron ${selected.length} de ${candidates.length} repositorios públicos`, details: { skipped: candidates.slice(MAX_REPOS) } });
      }

      // Un repo sin revisar no es un repo sin secretos: cualquier fallo tumba la fuente.
      const scanned: ScannedRepo[] = [];
      for (const fullName of selected) {
        ctx.signal.throwIfAborted();
        try {
          scanned.push({ fullName, leaks: await deps.scanRepo(fullName, ctx.signal) });
        } catch (err) {
          ctx.signal.throwIfAborted();
          const detail = (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'git o gitleaks no están instalados en el worker'
            : err instanceof Error ? err.message.split('\n')[0] : String(err);
          throw new Error(`No se pudo escanear ${fullName}: ${detail}`);
        }
      }

      notices.unshift({ kind: 'observation', subject: target.primaryDomain,
        message: `${scanned.length} repositorios públicos revisados`, details: { repos: selected } });
      return { assets: [], findings: mapLeaks(scanned, new Date()), notices };
    },
  };
}

// Escanea repositorios públicos en github.com (no es infraestructura de la empresa) con
// gitleaks. Solo clona; no ejecuta código del repositorio ni valida los secretos encontrados.
export const gitleaksCollector = createGitleaksCollector();
