import {Suspense} from 'react';
import PostEditor from '../../../components/community/post-editor';

export const metadata = {title: '글쓰기'};

// New post. `?category=` preselects the board (the list's "＋ 글쓰기" passes
// the board being viewed, like the legacy /community?category=…#write-post).
export default function Page() {
  return (
    <Suspense>
      <PostEditor />
    </Suspense>
  );
}
