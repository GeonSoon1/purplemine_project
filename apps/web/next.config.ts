import type { NextConfig } from 'next';

// 브라우저는 같은 출처의 /api 로 호출하고, Next가 백엔드로 넘긴다 (CORS 회피).
const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` }];
  },
};

export default nextConfig;
