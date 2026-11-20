import { describe, expect, it } from 'vitest';
import { findingsToResolve, type ResolutionCandidate, UNSEEN_SCANS_TO_RESOLVE } from './resolve';

const open = (findingId: string, lastSeenScanId: string | null): ResolutionCandidate => ({
  findingId,
  status: 'open',
  lastSeenScanId,
});

describe('findingsToResolve', () => {
  it('resuelve un hallazgo ausente en N escaneos exitosos consecutivos', () => {
    // s1 lo vio; s2..s4 (exitosos, más nuevos) no.
    const ok = ['s4', 's3', 's2', 's1'];
    expect(findingsToResolve(ok, [open('puerto-22', 's1')], 3)).toEqual(['puerto-22']);
  });

  it('no resuelve si se observó dentro de la ventana', () => {
    const ok = ['s4', 's3', 's2', 's1'];
    expect(findingsToResolve(ok, [open('a', 's4'), open('b', 's2')], 3)).toEqual([]);
  });

  it('no resuelve sin suficientes escaneos exitosos de la fuente', () => {
    // Los escaneos con la fuente fallida no llegan a esta lista: no cuentan para la racha.
    expect(findingsToResolve(['s3', 's2'], [open('a', 's1')], 3)).toEqual([]);
  });

  it('respeta las decisiones de triage', () => {
    const ok = ['s4', 's3', 's2'];
    const candidates: ResolutionCandidate[] = [
      { findingId: 'fp', status: 'false_positive', lastSeenScanId: 's1' },
      { findingId: 'acc', status: 'accepted', lastSeenScanId: 's1' },
      { findingId: 'res', status: 'resolved', lastSeenScanId: 's1' },
      open('abierto', 's1'),
    ];
    expect(findingsToResolve(ok, candidates, 3)).toEqual(['abierto']);
  });

  it('resuelve si el escaneo donde se vio por última vez ya no existe', () => {
    expect(findingsToResolve(['s3', 's2', 's1'], [open('a', null)], 3)).toEqual(['a']);
  });

  it('usa solo los N escaneos exitosos más recientes', () => {
    // Visto en s1, que queda fuera de la ventana de 2.
    expect(findingsToResolve(['s3', 's2', 's1'], [open('a', 's1')], 2)).toEqual(['a']);
  });

  it('rechaza umbrales inválidos', () => {
    expect(() => findingsToResolve(['s1'], [], 0)).toThrow();
    expect(() => findingsToResolve(['s1'], [], 1.5)).toThrow();
  });

  it('el supuesto por defecto exige más de un escaneo', () => {
    expect(UNSEEN_SCANS_TO_RESOLVE).toBeGreaterThan(1);
    expect(findingsToResolve(['s2'], [open('a', 's1')])).toEqual([]);
  });
});
