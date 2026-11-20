import { describe, expect, it } from 'vitest';
import { decideAlert } from './alerts';

describe('decideAlert', () => {
  it('sin cambios o con mejora no alerta', () => {
    expect(decideAlert('B', 'B', null)).toBeNull();
    expect(decideAlert('C', 'A', 'C')).toBeNull();
    expect(decideAlert(null, 'A', null)).toBeNull();
  });

  it('alerta cuando la nota baja', () => {
    expect(decideAlert('B', 'C', null)).toEqual({ type: 'grade_drop', previousGrade: 'B' });
  });

  it('alerta al cruzar el umbral, también en el primer puntaje', () => {
    expect(decideAlert('C', 'D', 'C')).toEqual({ type: 'threshold_crossed', previousGrade: 'C' });
    expect(decideAlert(null, 'E', 'C')).toEqual({ type: 'threshold_crossed', previousGrade: null });
  });

  it('bajo el umbral solo vuelve a alertar si la nota sigue bajando', () => {
    expect(decideAlert('D', 'D', 'C')).toBeNull();
    expect(decideAlert('D', 'F', 'C')).toEqual({ type: 'grade_drop', previousGrade: 'D' });
  });
});
