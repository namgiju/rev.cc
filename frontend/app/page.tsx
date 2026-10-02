import {fetchLatestListingsServer, fetchPublicGarageServer, fetchTodayPostsServer} from '../lib/server-api';
import {pickGarageSpotlight} from '../lib/format';
import HomeShell from '../components/home/home-shell';

export const metadata = {
  title: 'REV.CC | 당신의 드라이빙이 콘텐츠가 되는 곳',
  description: '커뮤니티, 내 차고, 부품장터가 하나로 연결되는 자동차 오너 공간, REV.CC.',
};

// 세 섹션 모두 매 요청마다 최신 데이터를 보여준다(세션 없이도 보이는 공개 데이터라
// 캐시로 얻을 이득이 적고, "오늘의 차고"는 날짜가 바뀌면 다른 차량을 보여줘야 한다).
export const dynamic = 'force-dynamic';

export default async function Page() {
  const [postsResult, garageResult, marketResult] = await Promise.allSettled([
    fetchTodayPostsServer({period: 'today', limit: 4}),
    fetchPublicGarageServer(),
    fetchLatestListingsServer(2),
  ]);

  const initialPosts = postsResult.status === 'fulfilled' ? postsResult.value : [];
  const garage = garageResult.status === 'fulfilled' ? garageResult.value : [];
  const market = marketResult.status === 'fulfilled' ? marketResult.value.items : [];

  return (
    <HomeShell
      initialPosts={initialPosts}
      initialPostsFailed={postsResult.status === 'rejected'}
      garageSpotlight={pickGarageSpotlight(garage)}
      market={market}
    />
  );
}
