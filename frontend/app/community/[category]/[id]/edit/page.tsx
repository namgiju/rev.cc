import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import PostEditor from '../../../../../components/community/post-editor';
import {POST_CATEGORIES} from '../../../../../lib/home-types';

export const metadata = {title: '게시글 수정'};

// Edit an existing post (legacy: /community/{category}/{id}#write-post).
// Same route checks as the detail page; ownership is checked client-side
// against the session and enforced by PUT /api/board/posts/:id.
export default async function Page({params}: {params: Promise<{category: string; id: string}>}) {
  const {category, id} = await params;
  if (!(POST_CATEGORIES as readonly string[]).includes(category)) notFound();
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) notFound();
  return (
    <Suspense>
      <PostEditor key={id} postId={Number(id)} />
    </Suspense>
  );
}
