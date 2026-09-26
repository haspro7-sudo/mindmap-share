// #/not-found and any unknown hash: a neutral message and a way back to 本棚.
import type { ReactNode } from 'react';
import { EmptyState } from '../components/EmptyState';
import { hrefFor } from '../router';

export function NotFoundScreen(): ReactNode {
  return (
    <main className="screen">
      <EmptyState
        icon="🔖"
        title="ページが見つかりません"
        body="リンクが古いか、アドレスがまちがっているかもしれません。"
        action={
          <a className="btn btn-primary" href={hrefFor({ name: 'home' })}>
            本棚に戻る
          </a>
        }
      />
    </main>
  );
}
