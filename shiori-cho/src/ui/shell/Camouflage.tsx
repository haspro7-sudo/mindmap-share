// F2 AC3: a plain 「メモ」 notepad backed by settings.camouflageText (debounced save). Nothing else is
// rendered: no app name, no work data. Returning: a 1-second long-press on the 「メモ」 heading (touch, mouse,
// or holding Enter / Space while it is focused). The shell decides whether the PIN is asked next.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLatest } from '../components/useLatest';
import { useSettings } from '../context';
import './Camouflage.css';

export const CAMOUFLAGE_RETURN_MS = 1000;
const SAVE_DELAY_MS = 400;

export function Camouflage({ onReturn }: { onReturn(): void }): ReactNode {
  const { settings, update } = useSettings();
  const [text, setText] = useState(settings.camouflageText);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateRef = useLatest(update);
  const onReturnRef = useLatest(onReturn);

  const flush = () => {
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    const value = pending.current;
    pending.current = null;
    if (value !== null) void updateRef.current({ camouflageText: value }).catch(() => undefined);
  };

  useEffect(
    () => () => {
      flush();
      if (holdTimer.current !== undefined) clearTimeout(holdTimer.current);
    },
    // flush reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onChange = (value: string) => {
    setText(value);
    pending.current = value;
    if (saveTimer.current !== undefined) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const startHold = () => {
    if (holdTimer.current !== undefined) clearTimeout(holdTimer.current);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = undefined;
      flush();
      onReturnRef.current();
    }, CAMOUFLAGE_RETURN_MS);
  };
  const cancelHold = () => {
    if (holdTimer.current !== undefined) clearTimeout(holdTimer.current);
    holdTimer.current = undefined;
  };

  return (
    <main className="camo" data-shell="camouflage">
      <h1
        className="camo-title"
        tabIndex={0}
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            e.preventDefault();
            startHold();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === 'Enter' || e.key === ' ') cancelHold();
        }}
        onBlur={cancelHold}
      >
        メモ
      </h1>
      <label htmlFor="camo-text" className="visually-hidden">
        メモ
      </label>
      <textarea
        id="camo-text"
        className="camo-text"
        value={text}
        placeholder="メモを入力"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onBlur={flush}
      />
    </main>
  );
}
