import {notFound} from 'next/navigation';
import MemberProfile from '../../../../components/community/member-profile';

export const metadata = {title: '오너 차고 | REV.CC'};

// Formerly the legacy /community#member-{id} dialog. A static segment wins
// over /community/[category]/[id], so this never collides with post URLs.
export default async function Page({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) notFound();
  return <MemberProfile key={id} memberId={Number(id)} />;
}
