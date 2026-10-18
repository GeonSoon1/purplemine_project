import type { Metadata } from 'next';
import { Big_Shoulders, IBM_Plex_Mono, IBM_Plex_Sans_KR } from 'next/font/google';
import { TopBar } from '@/components/TopBar';
import { ToastProvider } from '@/components/Toast';
import './globals.css';

const plex = IBM_Plex_Sans_KR({
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-plex',
  preload: false,
});
// 시안의 Big Shoulders Display는 Google Fonts에서 Big Shoulders로 이름이 바뀌었다.
const shoulders = Big_Shoulders({
  weight: ['700', '800'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-shoulders',
  adjustFontFallback: false,
});
// 시작 화면 HUD 글자 전용
const plexMono = IBM_Plex_Mono({
  weight: ['500'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: 'PURPLE MINE · 촬영 차량 견적',
  description: '대본을 올리면 씬별로 필요한 차량을 정리하고 견적서까지 만들어 드립니다.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${plex.variable} ${shoulders.variable} ${plexMono.variable}`}>
      <body>
        <ToastProvider>
          <TopBar />
          <main>{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}
