import type { ReactNode } from 'react';
import { TopNav } from '@/components/top-nav';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh' }}>
      <TopNav />
      <main className="appMain">{children}</main>
    </div>
  );
}
