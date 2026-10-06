import {Suspense} from 'react';
import AdminApp from '../../components/admin/admin-app';

export const metadata = {title: '관리자 | REV.CC'};

export default function Page() {
  return (
    <Suspense>
      <AdminApp />
    </Suspense>
  );
}
