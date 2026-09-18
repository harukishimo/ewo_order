import Link from 'next/link';
import { SiteSession } from '@/components/site-session';
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="site-header">
        <Link href="/" className="brand">
          Atelier<span>制作管理</span>
        </Link>
        <nav aria-label="管理メニュー">
          <Link href="/admin/tasks">制作ボード</Link>
          <SiteSession />
        </nav>
      </header>
      <div id="main-content">{children}</div>
    </>
  );
}
