import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import styles from '@/components/dashboard/dashboard.module.css';
import { UserManagement } from '@/components/users/user-management';
import { isLocalUserAdminEnabled } from '@/lib/local-user-admin';
import { createClient } from '@/lib/supabase/server';
import { loadUsers } from './actions';

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{title}</h1>
      <p className={styles.notice}>{children}</p>
    </div>
  );
}

export default async function UsersPage() {
  if (!isLocalUserAdminEnabled()) {
    return (
      <Notice title="Usuarios">
        La administración de usuarios solo está habilitada con Supabase local y una sesión real de administrador.
      </Notice>
    );
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single();
  if (profile?.role !== 'admin' || !profile.is_active) {
    return <Notice title="Acceso restringido">Solo un administrador activo puede gestionar usuarios.</Notice>;
  }
  const result = await loadUsers(1);
  return (
    <UserManagement
      currentUserId={user.id}
      initialUsers={result.users ?? []}
      initialHasMore={result.hasMore ?? false}
      initialError={result.error}
    />
  );
}
