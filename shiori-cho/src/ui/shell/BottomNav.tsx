// Bottom navigation: 本棚 (#/), 合言葉 (#/code), 設定 (#/settings). aria-current="page" on the current
// top-level page; sub-pages highlight their section.
import type { ReactNode } from 'react';
import { hrefFor, useRoute } from '../router';
import { sectionOf } from './navigation';
import type { NavSection } from './navigation';
import './BottomNav.css';

const ITEMS: ReadonlyArray<{ id: NavSection; label: string; icon: ReactNode }> = [
  {
    id: 'home',
    label: '本棚',
    icon: (
      <path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 5.2l3.8-1 3.2 15.4-3.8 1z" transform="translate(-1 0)" />
    ),
  },
  {
    id: 'code',
    label: '合言葉',
    icon: <path d="M14.5 3a6.5 6.5 0 0 0-6.2 8.5L3 16.8V21h4.2v-2.2h2.2v-2.2h2.2l1-1A6.5 6.5 0 1 0 14.5 3zm2 4.2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />,
  },
  {
    id: 'settings',
    label: '設定',
    icon: (
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 4.6l2-1.6-2-3.4-2.4.9a7.8 7.8 0 0 0-2-1.2L15.6 5h-4l-.4 2.8a7.8 7.8 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2.3l-2 1.6 2 3.4 2.4-.9c.6.5 1.3.9 2 1.2l.4 2.8h4l.4-2.8c.7-.3 1.4-.7 2-1.2l2.4.9 2-3.4-2-1.6a7.6 7.6 0 0 0 0-2.3z" />
    ),
  },
];

const HREF: Record<NavSection, string> = {
  home: hrefFor({ name: 'home' }),
  code: hrefFor({ name: 'code' }),
  settings: hrefFor({ name: 'settings' }),
};

export function BottomNav(): ReactNode {
  const route = useRoute();
  const section = sectionOf(route);
  return (
    <nav className="bnav" aria-label="メインメニュー">
      <ul className="bnav-list">
        {ITEMS.map((item) => {
          const exact = route.name === item.id;
          const inSection = section === item.id;
          return (
            <li key={item.id}>
              <a
                className={`bnav-item${inSection ? ' is-active' : ''}`}
                href={HREF[item.id]}
                aria-current={exact ? 'page' : inSection ? 'true' : undefined}
              >
                <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="currentColor">
                  {item.icon}
                </svg>
                <span className="bnav-label">{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
