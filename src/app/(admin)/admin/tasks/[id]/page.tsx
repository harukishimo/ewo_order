import { TaskDetail } from '@/components/admin/task-detail';
import '@/components/admin/admin.css';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TaskDetail id={id} />;
}
