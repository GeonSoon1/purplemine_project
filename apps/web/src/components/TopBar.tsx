'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const MENU = [
  { href: '/scripts', label: '대본' },
  { href: '/quotes', label: '견적서' },
  { href: '/vehicles', label: '보유 차량' },
];

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="logo" aria-label="PURPLE MINE 시작 화면">
          <span className="wm">
            PURPLE<em>MINE</em>
          </span>
          <small>STANDARD OF PREMIUM MOBILITY</small>
        </Link>
        <nav className="nav" aria-label="주 메뉴">
          {MENU.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className={pathname.startsWith(m.href) ? 'on' : undefined}
              aria-current={pathname.startsWith(m.href) ? 'page' : undefined}
            >
              {m.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
