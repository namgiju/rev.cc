import {Suspense} from 'react';
import CommunityList from '../../components/community/community-list';

export const metadata = {title: '커뮤니티 | REV.CC'};

export default function Page() {
  return (
    <Suspense>
      <CommunityList />
    </Suspense>
  );
}
