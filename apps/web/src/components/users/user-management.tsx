'use client';

import Link from 'next/link';
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from 'react';
import {
  changeUserPassword,
  createUser,
  loadUsers,
  updateUser,
  type UserActionResult,
} from '@/app/(dashboard)/settings/users/actions';
import dashboard from '@/components/dashboard/dashboard.module.css';
import { displayIdentifier } from '@/lib/local-user';
import type { ManagedUser } from '../../../../../supabase/functions/manage-users/handler';
import styles from './users.module.css';

type FormAction = (previous: UserActionResult, form: FormData) => Promise<UserActionResult>;

const ROLE_LABEL = { admin: 'Administrador', analyst: 'Analista' } as const;

// React 19 vacía el formulario al terminar una acción aunque devuelva error; enviar
// con onSubmit evita perder lo escrito y solo limpiamos cuando la acción tuvo éxito.
function useFormAction(action: FormAction, resetOnSuccess: boolean) {
  const [state, dispatch, pending] = useActionState(action, {});
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state.message) formRef.current?.reset();
  }, [state, resetOnSuccess]);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(() => dispatch(form));
  }
  return { state, pending, formRef, onSubmit };
}

function Feedback({ state }: { state: UserActionResult }) {
  return (
    <div aria-live="polite">
      {state.error && <p className={`${styles.feedback} ${styles.error}`} role="alert">{state.error}</p>}
      {state.message && <p className={`${styles.feedback} ${styles.success}`}>{state.message}</p>}
      {state.warning && <p className={`${styles.feedback} ${styles.warning}`}>{state.warning}</p>}
    </div>
  );
}

function PasswordFields() {
  return (
    <div className={styles.formRow}>
      <label className={styles.field}>
        Contraseña
        <input name="password" type="password" autoComplete="new-password" required minLength={6} maxLength={72} />
      </label>
      <label className={styles.field}>
        Confirmar
        <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={6} maxLength={72} />
      </label>
    </div>
  );
}

function RoleSelect({ defaultValue, disabled }: { defaultValue: ManagedUser['role']; disabled?: boolean }) {
  return (
    <select name="role" defaultValue={defaultValue} disabled={disabled}>
      <option value="analyst">{ROLE_LABEL.analyst}</option>
      <option value="admin">{ROLE_LABEL.admin}</option>
    </select>
  );
}

function CreateUserForm() {
  const { state, pending, formRef, onSubmit } = useFormAction(createUser, true);
  return (
    <section className={dashboard.card}>
      <div className={dashboard.cardHeader}>
        <div>
          <h2 className={dashboard.cardTitle}>Nuevo usuario</h2>
          <p className={dashboard.cardHint}>Queda inactivo hasta que lo actives en la lista.</p>
        </div>
      </div>
      <form ref={formRef} onSubmit={onSubmit}>
        <fieldset disabled={pending} className={styles.form}>
          <label className={styles.field}>
            Nombre completo
            <input name="fullName" required maxLength={120} autoComplete="off" />
          </label>
          <label className={styles.field}>
            Usuario
            <input name="email" required maxLength={254} autoComplete="off" placeholder="analista" />
            <span className={styles.fieldHint}>3–32 letras, números, puntos o guiones. También acepta un correo.</span>
          </label>
          <label className={styles.field}>
            Rol
            <RoleSelect defaultValue="analyst" />
          </label>
          <PasswordFields />
          <span className={styles.fieldHint}>Mínimo 6 caracteres.</span>
          <button type="submit" className={dashboard.button}>
            {pending ? 'Creando…' : 'Crear usuario'}
          </button>
          <Feedback state={state} />
        </fieldset>
      </form>
    </section>
  );
}

function ActiveToggle({ user }: { user: ManagedUser }) {
  const { state, pending, onSubmit } = useFormAction(updateUser, false);
  return (
    <form onSubmit={onSubmit} title={state.error}>
      <input type="hidden" name="id" value={user.id} />
      <input type="hidden" name="fullName" value={user.fullName} />
      <input type="hidden" name="role" value={user.role} />
      {!user.isActive && <input type="hidden" name="isActive" value="on" />}
      <button type="submit" className={user.isActive ? dashboard.buttonGhost : dashboard.button} disabled={pending}>
        {pending ? '…' : user.isActive ? 'Desactivar' : 'Activar'}
      </button>
    </form>
  );
}

function EditPanel({ user, isSelf }: { user: ManagedUser; isSelf: boolean }) {
  const profile = useFormAction(updateUser, false);
  const password = useFormAction(changeUserPassword, true);
  return (
    <div className={styles.editPanel}>
      <form onSubmit={profile.onSubmit}>
        <h3 className={styles.editTitle}>Perfil</h3>
        <input type="hidden" name="id" value={user.id} />
        <fieldset disabled={profile.pending} className={styles.form}>
          <label className={styles.field}>
            Nombre completo
            <input name="fullName" defaultValue={user.fullName} required maxLength={120} />
          </label>
          <label className={styles.field}>
            Rol
            <RoleSelect defaultValue={user.role} disabled={isSelf} />
            {isSelf && <span className={styles.fieldHint}>No puedes cambiar tu propio rol.</span>}
          </label>
          {/* Un select o checkbox deshabilitado no se envía: mandar el valor fijo. */}
          {isSelf && <input type="hidden" name="role" value="admin" />}
          {isSelf ? (
            <input type="hidden" name="isActive" value="on" />
          ) : (
            <label className={styles.checkbox}>
              <input name="isActive" type="checkbox" defaultChecked={user.isActive} />
              Acceso activo
            </label>
          )}
          <div className={styles.formActions}>
            <button type="submit" className={dashboard.button}>
              {profile.pending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
          <Feedback state={profile.state} />
        </fieldset>
      </form>
      <form ref={password.formRef} onSubmit={password.onSubmit}>
        <h3 className={styles.editTitle}>Contraseña</h3>
        <input type="hidden" name="id" value={user.id} />
        <fieldset disabled={password.pending} className={styles.form}>
          <PasswordFields />
          <div className={styles.formActions}>
            <button type="submit" className={dashboard.buttonGhost}>
              {password.pending ? 'Actualizando…' : 'Cambiar contraseña'}
            </button>
          </div>
          <Feedback state={password.state} />
        </fieldset>
      </form>
    </div>
  );
}

function UserRows({ user, isSelf }: { user: ManagedUser; isSelf: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <tr>
        <td>
          <span className={styles.userName}>{displayIdentifier(user.email)}</span>
          {isSelf && <span className={styles.you}>Tú</span>}
        </td>
        <td>{user.fullName || <span className={dashboard.muted}>—</span>}</td>
        <td>{ROLE_LABEL[user.role]}</td>
        <td>
          <span className={`${dashboard.pill} ${user.isActive ? styles.active : styles.inactive}`}>
            {user.isActive ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td className={dashboard.muted}>{new Date(user.createdAt).toLocaleDateString('es-MX')}</td>
        <td>
          <div className={styles.actions}>
            {!isSelf && <ActiveToggle user={user} />}
            <button
              type="button"
              className={dashboard.buttonGhost}
              aria-expanded={editing}
              onClick={() => setEditing((value) => !value)}
            >
              {editing ? 'Cerrar' : 'Editar'}
            </button>
          </div>
        </td>
      </tr>
      {editing && (
        <tr className={styles.editRow}>
          <td colSpan={6}>
            <EditPanel user={user} isSelf={isSelf} />
          </td>
        </tr>
      )}
    </>
  );
}

export function UserManagement({
  currentUserId,
  initialUsers,
  initialHasMore,
  initialError,
}: {
  currentUserId: string;
  initialUsers: ManagedUser[];
  initialHasMore: boolean;
  initialError?: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [page, setPage] = useState(1);
  const [error, setError] = useState(initialError);
  const [pending, startLoading] = useTransition();

  // Las acciones revalidan la ruta: el servidor manda la lista nueva como props.
  useEffect(() => {
    setUsers(initialUsers);
    setHasMore(initialHasMore);
    setPage(1);
    setError(initialError);
  }, [initialUsers, initialHasMore, initialError]);

  function navigate(nextPage: number) {
    startLoading(async () => {
      const result = await loadUsers(nextPage);
      setError(result.error);
      if (!result.error) {
        setUsers(result.users ?? []);
        setHasMore(result.hasMore ?? false);
        setPage(nextPage);
      }
    });
  }

  return (
    <div className={dashboard.page}>
      <div>
        <Link href="/settings" className={styles.back}>
          ← Configuración
        </Link>
        <h1 className={dashboard.pageTitle}>Usuarios</h1>
        <p className={dashboard.subtitle}>Cuentas locales con contraseña. Verificación por correo y MFA pendientes.</p>
      </div>

      {error && <p className={`${styles.feedback} ${styles.error}`} role="alert">{error}</p>}

      <div className={styles.layout}>
        <CreateUserForm />
        <section className={dashboard.card} aria-label="Usuarios registrados">
          <div className={dashboard.cardHeader}>
            <div>
              <h2 className={dashboard.cardTitle}>Usuarios registrados</h2>
              <p className={dashboard.cardHint}>
                {users.length} {users.length === 1 ? 'usuario' : 'usuarios'}
                {page > 1 ? ` en la página ${page}` : ''}
              </p>
            </div>
            <button type="button" className={dashboard.buttonGhost} disabled={pending} onClick={() => navigate(page)}>
              {pending ? 'Cargando…' : 'Actualizar'}
            </button>
          </div>
          {users.length === 0 ? (
            <p className={dashboard.empty}>{error ? 'No se pudo cargar la lista.' : 'No hay usuarios en esta página.'}</p>
          ) : (
            <div className={dashboard.tableWrap}>
              <table className={dashboard.table}>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Nombre</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Creado</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <UserRows key={user.id} user={user} isSelf={user.id === currentUserId} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(page > 1 || hasMore) && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={dashboard.buttonGhost}
                disabled={pending || page === 1}
                onClick={() => navigate(page - 1)}
              >
                Anterior
              </button>
              <span>Página {page}</span>
              <button
                type="button"
                className={dashboard.buttonGhost}
                disabled={pending || !hasMore}
                onClick={() => navigate(page + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
