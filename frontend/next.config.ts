import type {NextConfig} from 'next';

// 브라우저는 Next.js와 같은 출처로 요청하고, 기존 nginx를 통해 API에 접근한다.
// Docker 이미지 빌드 시에는 http://proxy, 로컬 개발 시에는 localhost:8090을 사용한다.
const backendOrigin = process.env.REVCC_API_ORIGIN || 'http://localhost:8090';
const config: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [{source: '/api/:path*', destination: `${backendOrigin}/api/:path*`}];
  },
};
export default config;
