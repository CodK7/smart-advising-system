import AdminDashboard from './AdminDashboard';
import type { TabId } from './Dashboard';
import type { User } from '../data';

interface Props {
  activeTab: TabId;
  language: 'ar' | 'en';
  currentUser: User;
}

export default function RegistrarAdminDashboard(props: Props) {
  return <AdminDashboard {...props} />;
}
