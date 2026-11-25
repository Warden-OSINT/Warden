import assert from 'node:assert/strict';
import test from 'node:test';
import { hasFreshMfa, isTotpCode, lastTotpAt, mfaGate, normalizeTotpCode } from '../src/lib/mfa.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 25);

test('exige MFA vigente en toda la app y manda al paso del código si falta', () => {
  assert.equal(mfaGate('/', false), 'to-mfa');
  assert.equal(mfaGate('/settings/users', false), 'to-mfa');
  assert.equal(mfaGate('/api/scans', false), 'to-mfa');
  assert.equal(mfaGate('/mfa', false), 'allow');
  assert.equal(mfaGate('/login', false), 'allow');
  assert.equal(mfaGate('/mfasomething', false), 'to-mfa');
  assert.equal(mfaGate('/', true), 'allow');
  assert.equal(mfaGate('/mfa', true), 'to-home');
});

test('con MFA vigente /login manda al dashboard para no abrir otra sesión', () => {
  assert.equal(mfaGate('/login', true), 'to-home');
  assert.equal(mfaGate('/loginx', true), 'allow');
});

test('la MFA vence a la semana del último código', () => {
  assert.ok(hasFreshMfa('aal2', now - 6 * DAY, now));
  assert.ok(!hasFreshMfa('aal2', now - 7 * DAY, now));
  assert.ok(!hasFreshMfa('aal2', null, now));
  assert.ok(!hasFreshMfa('aal1', now, now));
});

test('toma el último código TOTP del claim amr', () => {
  const at = (ms: number) => Math.floor(ms / 1000);
  assert.equal(lastTotpAt([
    { method: 'password', timestamp: at(now) },
    { method: 'totp', timestamp: at(now - 3 * DAY) },
    { method: 'mfa/totp', timestamp: at(now - DAY) },
  ]), at(now - DAY) * 1000);
  assert.equal(lastTotpAt([{ method: 'password', timestamp: at(now) }]), null);
  assert.equal(lastTotpAt(['totp']), null);
  assert.equal(lastTotpAt(undefined), null);
});

test('valida códigos TOTP de 6 dígitos', () => {
  assert.equal(normalizeTotpCode(' 123 456 '), '123456');
  assert.ok(isTotpCode('012345'));
  for (const code of ['12345', '1234567', '12a456', '']) assert.ok(!isTotpCode(code));
});
