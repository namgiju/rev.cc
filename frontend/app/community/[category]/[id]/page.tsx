import {notFound} from 'next/navigation';
import PostDetail from '../../../../components/community/post-detail';
import {POST_CATEGORIES} from '../../../../lib/home-types';

export const metadata = {title: '커뮤니티 | REV.CC'};

// Canonical post URL /community/{category}/{id} — the same pattern
// assignment-frontend/nginx.conf routes to the legacy detail page. A wrong
// (but valid) category is corrected client-side once the post is loaded.
export default async function Page({params}: {params: Promise<{category: string; id: string}>}) {
  const {category, id} = await params;
  if (!(POST_CATEGORIES as readonly string[]).includes(category)) notFound();
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) notFound();
  return <PostDetail key={id} postId={Number(id)} />;
}
