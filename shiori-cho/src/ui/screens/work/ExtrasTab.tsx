// おまけ tab (docs/SPEC.md F12 AC1–AC2): sealed extras with label, spoiler-gated teaser, kind icon and
// condition progress (「2/4」 for allOf, 「いずれか1つ」 for anyOf). Opened items open the reader sheet;
// opened-but-unseen items are queued for the envelope animation.
import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import type { SealedItem, SpoilerLevel } from '../../../core/types';
import { EmptyState } from '../../components/EmptyState';
import { SEALED_KIND_ICON, SEALED_KIND_LABEL } from '../../components/sealedKind';
import { SpoilerText } from '../../components/SpoilerText';
import { useUi } from '../../context';
import { conditionText, sealedSpoiler } from './workModel';
import type { WorkData } from './workModel';

export interface ExtrasTabProps {
  data: WorkData;
  tolerance: SpoilerLevel;
  onOpen(index: number): void;
}

export function ExtrasTab({ data, tolerance, onOpen }: ExtrasTabProps): ReactNode {
  const ui = useUi();
  const queued = useRef(new Set<string>());
  const workId = data.work.id;

  // Opened items the player has not seen yet play the envelope animation (the reader marks them seen).
  const unseen = data.sealedOpens.filter((o) => !o.seen).map((o) => o.sealedId);
  const unseenKey = unseen.join('\u0000');
  useEffect(() => {
    const ids = unseenKey === '' ? [] : unseenKey.split('\u0000');
    const fresh = ids.filter((id) => !queued.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) queued.current.add(id);
    ui.queueEnvelopes(fresh.map((sealedId) => ({ workId, sealedId })));
  }, [unseenKey, workId, ui]);

  const m = data.manifest;
  if (!m) {
    return <EmptyState icon="✉️" title="おまけはまだありません" body="しおりファイルを読み込むと、合言葉で開くおまけがここに並びます。" />;
  }
  if (m.sealed.length === 0) {
    return <EmptyState icon="✉️" title="おまけはありません" body="このしおりには封印おまけが入っていません。" />;
  }

  const opened = new Set(data.sealedOpens.map((o) => o.sealedId));
  const redeemed = new Set(data.redeemedGoalIds);
  return (
    <div className="stack">
      <p className="small muted">合言葉を入れると、条件を満たしたおまけが開きます。</p>
      <ul className="wk-extras">
        {m.sealed.map((item, index) => (
          <ExtraCard
            key={item.id}
            item={item}
            opened={opened.has(item.id)}
            condition={conditionText(item, redeemed)}
            spoiler={sealedSpoiler(m, item)}
            tolerance={tolerance}
            onOpen={() => onOpen(index)}
          />
        ))}
      </ul>
    </div>
  );
}

function ExtraCard(props: {
  item: SealedItem;
  opened: boolean;
  condition: string;
  spoiler: SpoilerLevel;
  tolerance: SpoilerLevel;
  onOpen(): void;
}): ReactNode {
  const { item, opened } = props;
  const labelId = useId();
  const mode = item.unlock.mode === 'allOf' ? 'すべての合言葉' : 'どれかの合言葉';
  return (
    <li className={`card wk-x${opened ? ' is-open' : ''}`}>
      <span className="wk-x-icon" aria-hidden="true">
        {opened ? SEALED_KIND_ICON[item.kind] : '🔒'}
      </span>
      <div className="wk-x-main">
        <h3 id={labelId} className="wk-x-label">
          {item.label}
        </h3>
        <p className="wk-x-kind small muted">
          <span aria-hidden="true">{SEALED_KIND_ICON[item.kind]}</span> {SEALED_KIND_LABEL[item.kind]}
        </p>
        {item.teaser ? (
          <SpoilerText as="p" className="wk-x-teaser small" text={item.teaser} spoiler={props.spoiler} tolerance={props.tolerance} />
        ) : null}
        <div className="wk-x-meta">
          {opened ? <span className="badge badge-ok">開封済み</span> : <span className="badge">封印中</span>}
          <span className="badge wk-x-cond" title={mode}>
            <span className="visually-hidden">開く条件：</span>
            {props.condition}
          </span>
        </div>
      </div>
      {opened ? (
        <button type="button" className="btn btn-sm btn-primary wk-x-open" aria-describedby={labelId} onClick={props.onOpen}>
          読む
        </button>
      ) : null}
    </li>
  );
}
