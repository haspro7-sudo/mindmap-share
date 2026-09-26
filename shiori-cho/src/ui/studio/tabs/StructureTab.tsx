// 工房 › 章・グループ tab (docs/SPEC.md §6): checkpoints (story order) and groups, with add / rename / delete
// and up/down reordering. Renaming an id also updates every reference to it (goal.group, missable.before).
import type { ReactNode } from 'react';
import { MANIFEST_LIMITS } from '../../../core/manifest/schema';
import type { Checkpoint, Group, StudioProject } from '../../../core/types';
import { useUi } from '../../context';
import { IdField, ItemTools, TextField } from './fields';
import {
  ID_PATTERN_HELP,
  idError,
  itemKeys,
  moveItem,
  removeAt,
  renameCheckpoint,
  renameGroup,
  replaceAt,
  uniqueId,
} from './model';
import type { StudioTabProps } from './model';

export function StructureTab({ project, update }: StudioTabProps): ReactNode {
  return (
    <div className="stack stu-tab">
      <CheckpointsSection project={project} update={update} />
      <GroupsSection project={project} update={update} />
    </div>
  );
}

function CheckpointsSection({ project, update }: StudioTabProps): ReactNode {
  const ui = useUi();
  const list = project.checkpoints;
  const keys = itemKeys(list);
  const setList = (fn: (l: Checkpoint[]) => Checkpoint[]) => update((p) => ({ ...p, checkpoints: fn(p.checkpoints) }));

  const add = () => {
    const id = uniqueId('ch', project.checkpoints.map((c) => c.id));
    setList((l) => [...l, { id, label: `第${l.length + 1}章` }]);
  };

  const remove = async (i: number) => {
    const c = list[i];
    if (!c) return;
    const users = project.goals.filter((g) => g.missable?.before === c.id).length;
    const ok = await ui.confirm({
      title: `章「${c.label || c.id}」を削除しますか？`,
      body:
        users > 0
          ? `この章を「取り返し注意」に使っている目標が${users}件あります。削除したあとで、その目標の章を選び直してください。`
          : undefined,
      okLabel: '削除',
      danger: true,
    });
    if (ok) setList((l) => removeAt(l, i));
  };

  return (
    <section className="card-flat stack" aria-labelledby="stu-cps">
      <div className="row">
        <h2 id="stu-cps" className="stu-h2">
          章（現在地）
        </h2>
        <span className="badge badge-warn stu-vis">公開</span>
      </div>
      <p className="field-hint">
        プレイヤーが「いまどこ？」で選ぶ区切りです。物語の順に上から並べてください。「取り返し注意」の目印にも使います（任意）。
      </p>
      {list.length === 0 ? <p className="small muted">まだありません。</p> : null}
      <ol className="stu-items">
        {list.map((c, i) => {
          const name = `章「${c.label || c.id}」`;
          return (
            <li key={keys[i]} className="stu-item">
              <div className="stu-item-grid">
                <TextField
                  label={`${i + 1}. 章の名前`}
                  value={c.label}
                  maxLength={40}
                  onChange={(v) => setList((l) => replaceAt(l, i, { ...c, label: v }))}
                  error={c.label.trim() === '' ? '名前を入力してください' : null}
                />
                <div className="stu-item-idrow">
                  <IdField
                    compact
                    label="ID"
                    value={c.id}
                    validate={(next) =>
                      idError(
                        next,
                        c.id,
                        project.checkpoints.filter((_, k) => k !== i).map((x) => x.id),
                      )
                    }
                    onCommit={(next) => update((p) => renameCheckpoint(p, c.id, next))}
                  />
                  <ItemTools
                    name={name}
                    index={i}
                    count={list.length}
                    onMove={(d) => setList((l) => moveItem(l, i, d))}
                    onDelete={() => void remove(i)}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="row-wrap">
        <button type="button" className="btn btn-sm" onClick={add} disabled={list.length >= MANIFEST_LIMITS.checkpoints}>
          ＋ 章を追加
        </button>
      </div>
    </section>
  );
}

function goalsInGroup(p: StudioProject, groupId: string): number {
  return p.goals.filter((g) => g.group === groupId).length;
}

function GroupsSection({ project, update }: StudioTabProps): ReactNode {
  const ui = useUi();
  const list = project.groups;
  const keys = itemKeys(list);
  const setList = (fn: (l: Group[]) => Group[]) => update((p) => ({ ...p, groups: fn(p.groups) }));

  const add = () => {
    const id = uniqueId('group-', project.groups.map((g) => g.id));
    setList((l) => [...l, { id, label: `グループ${l.length + 1}` }]);
  };

  const remove = async (i: number) => {
    const g = list[i];
    if (!g) return;
    if (list.length <= MANIFEST_LIMITS.groupsMin) {
      ui.toast('グループは1つ以上必要です', { tone: 'danger' });
      return;
    }
    const users = goalsInGroup(project, g.id);
    const ok = await ui.confirm({
      title: `グループ「${g.label || g.id}」を削除しますか？`,
      body: users > 0 ? `このグループの目標が${users}件あります。削除したあとで、それらの目標のグループを選び直してください。` : undefined,
      okLabel: '削除',
      danger: true,
    });
    if (ok) setList((l) => removeAt(l, i));
  };

  return (
    <section className="card-flat stack" aria-labelledby="stu-groups">
      <div className="row">
        <h2 id="stu-groups" className="stu-h2">
          グループ
        </h2>
        <span className="badge badge-warn stu-vis">公開</span>
      </div>
      <p className="field-hint">目標を「エンディング」「実績」などにまとめます。上から順に表示されます（1つ以上）。</p>
      <ol className="stu-items">
        {list.map((g, i) => {
          const name = `グループ「${g.label || g.id}」`;
          const count = goalsInGroup(project, g.id);
          return (
            <li key={keys[i]} className="stu-item">
              <div className="stu-item-grid">
                <TextField
                  label={`${i + 1}. グループの名前`}
                  value={g.label}
                  maxLength={20}
                  onChange={(v) => setList((l) => replaceAt(l, i, { ...g, label: v }))}
                  error={g.label.trim() === '' ? '名前を入力してください' : null}
                  hint={`目標 ${count}件`}
                />
                <div className="stu-item-idrow">
                  <IdField
                    compact
                    label="ID"
                    value={g.id}
                    validate={(next) =>
                      idError(
                        next,
                        g.id,
                        project.groups.filter((_, k) => k !== i).map((x) => x.id),
                      )
                    }
                    onCommit={(next) => update((p) => renameGroup(p, g.id, next))}
                  />
                  <ItemTools
                    name={name}
                    index={i}
                    count={list.length}
                    onMove={(d) => setList((l) => moveItem(l, i, d))}
                    onDelete={() => void remove(i)}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="row-wrap">
        <button type="button" className="btn btn-sm" onClick={add} disabled={list.length >= MANIFEST_LIMITS.groups}>
          ＋ グループを追加
        </button>
      </div>
      <p className="small muted">IDは{ID_PATTERN_HELP}。変えると、目標の設定も自動で書き換わります。</p>
    </section>
  );
}
