import assert from 'node:assert/strict';
import test from 'node:test';
import { createUserAdminHandler, type UserCommand } from './handler.ts';

const adminId = '00000000-0000-4000-8000-00000000a001';
const otherId = '00000000-0000-4000-8000-00000000a002';
const account = { email: 'Analista@warden.test ', password: 'contraseña-segura-123', fullName: ' Analista ', role: 'analyst' };

function fixture(authorized = true, enabled = true) {
  const calls: UserCommand[] = [];
  const handler = createUserAdminHandler({
    async authorize(token) { return authorized && token === 'valid-token' ? adminId : null; },
    async execute(_actorId, command) { calls.push(command); return { success: true }; },
  }, enabled);
  const send = (body: unknown, token = 'valid-token') => handler(new Request('http://local/manage-users', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  }));
  return { calls, handler, send };
}

test('rechaza el modo deshabilitado y a los usuarios sin autorización antes de ejecutar operaciones', async () => {
  for (const setup of [fixture(true, false), fixture(false), fixture()]) {
    const response = await setup.send({ action: 'list' }, 'invalid-token');
    assert.equal(response.status, 403);
    assert.equal(setup.calls.length, 0);
  }
  const setup = fixture();
  assert.equal((await setup.handler(new Request('http://local', { method: 'POST' }))).status, 401);
  assert.equal((await setup.handler(new Request('http://local'))).status, 405);
});

test('normaliza cuentas, permite los roles conocidos y descarta campos de privilegios adicionales', async () => {
  const setup = fixture();
  const response = await setup.send({ action: 'create', ...account, isActive: true, service_role: true });
  assert.equal(response.status, 200);
  assert.deepEqual(setup.calls[0], { action: 'create', ...account, email: 'analista@warden.test', fullName: 'Analista' });
});

test('valida contraseñas en bytes, nombres, correo, ids, roles y páginas', async () => {
  const invalid = [
    { action: 'create', ...account, password: 'corta' },
    { action: 'create', ...account, password: '🔐'.repeat(19) },
    { action: 'create', ...account, email: 'usuario inválido' },
    { action: 'create', ...account, fullName: ' ' },
    { action: 'create', ...account, role: 'service_role' },
    { action: 'password', id: 'incorrecto', password: account.password },
    { action: 'update', id: otherId, fullName: 'Analista', role: 'admin', isActive: 'true' },
    { action: 'list', page: -1 }, { action: 'list', page: 1.5 }, { action: 'delete', id: otherId },
  ];
  const setup = fixture();
  for (const body of invalid) assert.equal((await setup.send(body)).status, 400);
  assert.equal(setup.calls.length, 0);
});

test('crea un usuario sin correo real mediante un identificador local estable', async () => {
  const setup = fixture();
  assert.equal((await setup.send({ action: 'create', ...account, email: ' Analista_01 ' })).status, 200);
  assert.equal(setup.calls[0]?.action === 'create' && setup.calls[0].email, 'analista_01@warden.test');
});

test('impide que el administrador se desactive o quite su propio rol', async () => {
  const setup = fixture();
  const update = { action: 'update', id: adminId, fullName: 'Admin', role: 'admin', isActive: true };
  assert.equal((await setup.send({ ...update, role: 'analyst' })).status, 400);
  assert.equal((await setup.send({ ...update, isActive: false })).status, 400);
  assert.equal((await setup.send(update)).status, 200);
  assert.equal((await setup.send({ ...update, id: otherId, role: 'analyst', isActive: false })).status, 200);
});

test('acepta cambios de contraseña y paginación y no incluye contraseñas en la respuesta', async () => {
  const setup = fixture();
  const response = await setup.send({ action: 'password', id: otherId, password: account.password });
  assert.equal(response.status, 200);
  assert.ok(!(await response.text()).includes(account.password));
  assert.equal((await setup.send({ action: 'list', page: 2 })).status, 200);
  assert.deepEqual(setup.calls[1], { action: 'list', page: 2 });
});

test('rechaza JSON malformado y oculta detalles internos y secretos en errores', async () => {
  const setup = fixture();
  assert.equal((await setup.handler(new Request('http://local', {
    method: 'POST', headers: { Authorization: 'Bearer valid-token' }, body: '{',
  }))).status, 400);
  const handler = createUserAdminHandler({
    async authorize() { return adminId; },
    async execute() { throw new Error('secret-service-key'); },
  }, true);
  const response = await handler(new Request('http://local', {
    method: 'POST', headers: { Authorization: 'Bearer valid-token' }, body: '{"action":"list"}',
  }));
  assert.equal(response.status, 500);
  assert.ok(!(await response.text()).includes('secret-service-key'));
});
