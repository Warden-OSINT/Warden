export interface ManagedUser {
  id: string;
  email: string;
  fullName: string;
  role: 'admin' | 'analyst';
  isActive: boolean;
  createdAt: string;
}

export type UserCommand =
  | { action: 'list'; page: number }
  | { action: 'create'; email: string; password: string; fullName: string; role: 'admin' | 'analyst' }
  | { action: 'update'; id: string; fullName: string; role: 'admin' | 'analyst'; isActive: boolean }
  | { action: 'password'; id: string; password: string };

export interface UserAdminBackend {
  authorize(token: string): Promise<string | null>;
  execute(actorId: string, command: UserCommand): Promise<unknown>;
}

export class UserAdminError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseCommand(value: unknown): UserCommand {
  if (!value || typeof value !== 'object') throw new UserAdminError(400, 'Solicitud inválida');
  const input = value as Record<string, unknown>;
  if (input.action === 'list') {
    const page = input.page ?? 1;
    if (!Number.isInteger(page) || Number(page) < 1 || Number(page) > 10000) {
      throw new UserAdminError(400, 'Página inválida');
    }
    return { action: 'list', page: Number(page) };
  }
  if (input.action !== 'create' && input.action !== 'update' && input.action !== 'password') {
    throw new UserAdminError(400, 'Acción inválida');
  }
  const id = typeof input.id === 'string' ? input.id : '';
  if (input.action !== 'create' && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) {
    throw new UserAdminError(400, 'Usuario inválido');
  }
  if (input.action === 'create' || input.action === 'password') {
    // bcrypt limita la entrada a 72 bytes: no aceptar contraseñas que se truncarían.
    if (typeof input.password !== 'string' || input.password.length < 6 || new TextEncoder().encode(input.password).length > 72) {
      throw new UserAdminError(400, 'La contraseña debe tener al menos 6 caracteres y como máximo 72 bytes');
    }
    if (input.action === 'password') return { action: 'password', id, password: input.password };
  }
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  if (!fullName || fullName.length > 120) throw new UserAdminError(400, 'El nombre es obligatorio (máximo 120 caracteres)');
  if (input.role !== 'admin' && input.role !== 'analyst') throw new UserAdminError(400, 'Rol inválido');
  if (input.action === 'update') {
    if (typeof input.isActive !== 'boolean') throw new UserAdminError(400, 'Estado inválido');
    return { action: 'update', id, fullName, role: input.role, isActive: input.isActive };
  }
  const identifier = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!identifier.includes('@') && !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(identifier)) {
    throw new UserAdminError(400, 'El usuario debe tener entre 3 y 32 letras, números, puntos, guiones o guiones bajos');
  }
  const email = identifier.includes('@') ? identifier : `${identifier}@warden.test`;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new UserAdminError(400, 'Correo inválido');
  }
  return { action: 'create', email, password: input.password as string, fullName, role: input.role };
}

export function createUserAdminHandler(backend: UserAdminBackend, enabled: boolean) {
  return async (request: Request): Promise<Response> => {
    const reply = (body: unknown, status = 200) => Response.json(body, {
      status, headers: { 'Cache-Control': 'no-store' },
    });
    if (!enabled) return reply({ error: 'La administración local de usuarios está deshabilitada' }, 403);
    if (request.method !== 'POST') return reply({ error: 'Método no permitido' }, 405);
    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply({ error: 'Sesión requerida' }, 401);
    try {
      const actorId = await backend.authorize(token);
      if (!actorId) return reply({ error: 'Solo un administrador activo puede gestionar usuarios' }, 403);
      const body = await request.text();
      if (body.length > 8192) return reply({ error: 'Solicitud demasiado grande' }, 413);
      let value: unknown;
      try { value = JSON.parse(body); } catch { return reply({ error: 'Solicitud inválida' }, 400); }
      const command = parseCommand(value);
      if (command.action === 'update' && command.id === actorId && (!command.isActive || command.role !== 'admin')) {
        return reply({ error: 'No puedes desactivar tu propia cuenta ni quitarte el rol de administrador' }, 400);
      }
      return reply(await backend.execute(actorId, command));
    } catch (error) {
      return reply({ error: error instanceof UserAdminError ? error.message : 'No se pudo completar la operación de usuarios' },
        error instanceof UserAdminError ? error.status : 500);
    }
  };
}
