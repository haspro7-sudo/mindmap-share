// #/demo-pc PC画面シミュレータ (docs/SPEC.md F17 AC3, §6).
// A 16:9 fake game window for the demo 「星読みの図書館」 (サンプルA): click / tap / Enter advances the text box,
// choices branch to the four endings, every ending shows its 合言葉 with a QR code and 「この端末で入力する」
// (same-device deep link #/u/<workId>/<code>), and the title screen's 「扉の合言葉」 opens the bonus scene.
// All scene text comes from src/demo/pcScenes.ts; the mood is CSS gradients and emoji only (no images).
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, MouseEvent, ReactNode } from 'react';
import { importBundledDemos } from '../../app/library';
import { parseCode } from '../../core/codes';
import { isShioriError } from '../../core/errors';
import { buildUnlockUrl } from '../../core/route';
import { DEMO_HOSHIYOMI } from '../../demo/demoCodes';
import { PC_BONUS, PC_START, PC_WORK_ID, getPcScene, isDoorCode } from '../../demo/pcScenes';
import type { PcChoice, PcDoorInput, PcEnding, PcScene } from '../../demo/pcScenes';
import { QrCode } from '../studio/QrCode';
import { useRepo, useRepoQuery, useSettings, useUi } from '../context';
import { displayTitle } from '../format';
import { hrefFor, navigate } from '../router';
import './DemoPc.css';

export const DPC_INTRO =
  'これはサンプル作品のPC画面を再現したものです。エンディングで表示される合言葉を、スマホのしおり帳に入れてみてください。';
export const DPC_DOOR_EMPTY = '合言葉を入力してください';
const MSG_UNEXPECTED = 'うまく処理できませんでした。もう一度お試しください';

type Mood = 'night' | 'room' | 'moon' | 'cellar' | 'dawn';

/** Emoji "art" and background mood per scene (decoration only). */
const SCENE_LOOK: Readonly<Record<string, { art: string; mood: Mood }>> = {
  [PC_START]: { art: '📚🌙', mood: 'night' },
  prologue: { art: '🌠🏛️', mood: 'night' },
  'reading-room': { art: '📚🕯️🐈', mood: 'room' },
  'star-maps': { art: '🗺️✨', mood: 'room' },
  'star-maps-miss': { art: '🗺️💭', mood: 'room' },
  'end-a': { art: '🗺️🌟', mood: 'night' },
  'moon-seat': { art: '🪑🌙', mood: 'moon' },
  'end-b': { art: '🌕📖', mood: 'moon' },
  'cat-path': { art: '🐈🕯️', mood: 'cellar' },
  'end-c': { art: '🔖🐈', mood: 'cellar' },
  stairs: { art: '🗝️🚪', mood: 'room' },
  observatory: { art: '🔭✨', mood: 'night' },
  'end-true': { art: '🔭🌌', mood: 'dawn' },
  [PC_BONUS]: { art: '🚪✨🐈', mood: 'room' },
};
const DEFAULT_LOOK = { art: '📚', mood: 'night' as Mood };

/** 'ミナ「ようこそ」' → name plate 'ミナ' + '「ようこそ」'; anything else is narration. */
const SPEAKER_RE = /^([^「」\s（）()]{1,12})(「[\s\S]*」)$/u;

function splitSpeaker(line: string): { speaker?: string; text: string } {
  const m = SPEAKER_RE.exec(line);
  return m ? { speaker: m[1]!, text: m[2]! } : { text: line };
}

/** Same-device deep-link code and the QR URL for an ending's 合言葉 (null if the display form does not parse). */
function endingLink(ending: PcEnding, appUrl: string): { code: string; url: string } | null {
  const parsed = parseCode(ending.display);
  if (!parsed.ok) return null;
  return {
    code: parsed.canonical.replace(/^(b32|kana):/, ''),
    url: buildUnlockUrl(appUrl, PC_WORK_ID, parsed.canonical),
  };
}

function currentAppUrl(): string {
  return typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`;
}

interface Position {
  sceneId: string;
  /** index of the line shown in the text box */
  line: number;
}

const INTERACTIVE = 'button, a, input, select, textarea, label, form, [role="button"]';

export function DemoPcScreen(): ReactNode {
  const repo = useRepo();
  const ui = useUi();
  const { settings } = useSettings();
  const [pos, setPos] = useState<Position>({ sceneId: PC_START, line: 0 });
  const [importing, setImporting] = useState(false);
  const windowRef = useRef<HTMLDivElement>(null);
  /** set by user actions: move focus to the scene's [data-autofocus] element after the next render */
  const focusPending = useRef(false);

  const scene: PcScene = getPcScene(pos.sceneId) ?? getPcScene(PC_START)!;
  const isTitle = scene.doorInput !== undefined;
  const lastLine = Math.max(0, scene.lines.length - 1);
  const line = Math.min(pos.line, lastLine);
  const reading = !isTitle && line < lastLine;
  const look = SCENE_LOOK[scene.id] ?? DEFAULT_LOOK;
  const gameTitle = displayTitle(DEMO_HOSHIYOMI, settings);

  const demo = useRepoQuery((r) => r.findWorkByManifestWorkId(PC_WORK_ID), []);
  const showImport = !demo.loading && demo.error === undefined && demo.data === undefined;

  const goTo = useCallback((sceneId: string) => {
    focusPending.current = true;
    setPos({ sceneId: getPcScene(sceneId) ? sceneId : PC_START, line: 0 });
  }, []);

  const advance = useCallback(() => {
    focusPending.current = true;
    setPos((p) => {
      const s = getPcScene(p.sceneId);
      if (!s || s.doorInput || p.line >= s.lines.length - 1) return p;
      return { ...p, line: p.line + 1 };
    });
  }, []);

  // After a user action, focus the preferred control of the new state (次へ / first choice / ending button).
  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    const target = windowRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    if (target && target !== document.activeElement) target.focus();
  }, [pos]);

  // Enter advances the text box when nothing else has focus (or the game window itself does).
  useEffect(() => {
    if (!reading) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const active = document.activeElement;
      const win = windowRef.current;
      if (active && active !== document.body && active !== win) {
        const insideWin = win?.contains(active) ?? false;
        if (!insideWin || active.closest(INTERACTIVE)) return;
      }
      e.preventDefault();
      advance();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reading, advance]);

  const onScreenClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!reading) return;
    if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
    advance();
  };

  const onImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      await importBundledDemos(repo);
      ui.toast('サンプルを本棚に入れました', {
        tone: 'ok',
        action: { label: '本棚を見る', onClick: () => navigate({ name: 'home' }) },
      });
    } catch (e) {
      if (!isShioriError(e)) console.error('[shiori]', e);
      ui.toast(isShioriError(e) ? e.messageJa : MSG_UNEXPECTED, { tone: 'danger' });
    } finally {
      setImporting(false);
    }
  };

  const onEnter = (code: string) => navigate({ name: 'unlock', manifestWorkId: PC_WORK_ID, code });

  return (
    <main className="screen dpc">
      <section className="dpc-bar" aria-labelledby="dpc-heading">
        <div className="dpc-bar-text">
          <h1 id="dpc-heading" className="dpc-heading">
            <span aria-hidden="true">🖥️ </span>PC画面シミュレータ
          </h1>
          <p className="dpc-intro">{DPC_INTRO}</p>
        </div>
        <div className="dpc-bar-actions">
          <a className="btn" href={hrefFor({ name: 'home' })}>
            本棚に戻る
          </a>
          {showImport ? (
            <button type="button" className="btn btn-primary" onClick={() => void onImport()} disabled={importing} aria-busy={importing}>
              サンプルを本棚に入れる
            </button>
          ) : null}
          {demo.data ? <span className="badge badge-ok dpc-bar-badge">サンプルは本棚にあります</span> : null}
        </div>
      </section>

      <section className="dpc-stage" aria-label="サンプル作品のゲーム画面">
        <div className="dpc-window" ref={windowRef} tabIndex={-1}>
          <div className="dpc-chrome">
            <span className="dpc-chrome-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="dpc-chrome-title">{gameTitle}</span>
            {isTitle ? null : (
              <button type="button" className="dpc-chrome-btn" onClick={() => goTo(PC_START)}>
                タイトルへ
              </button>
            )}
          </div>
          <div className="dpc-screen" data-mood={look.mood} onClick={onScreenClick}>
            <div className="dpc-sky" aria-hidden="true" />
            <div className="dpc-shelves" aria-hidden="true" />
            {isTitle ? (
              <TitleView key={scene.id} scene={scene} door={scene.doorInput!} title={gameTitle} art={look.art} onChoice={goTo} />
            ) : (
              <div className="dpc-scene" key={scene.id}>
                <h2 className="dpc-scene-title">{scene.title}</h2>
                <div className="dpc-center">
                  {reading ? (
                    <p className="dpc-art" aria-hidden="true">
                      {look.art}
                    </p>
                  ) : scene.ending ? (
                    <EndingCard ending={scene.ending} choices={scene.choices ?? []} onChoice={goTo} onEnter={onEnter} />
                  ) : (
                    <Choices choices={scene.choices ?? []} onChoice={goTo} />
                  )}
                </div>
                <TextBox sceneId={scene.id} text={scene.lines[line] ?? ''} reading={reading} onNext={advance} />
              </div>
            )}
          </div>
        </div>
        <p className="dpc-hint">クリック・タップ・Enterキーで文章を進めます</p>
      </section>
    </main>
  );
}

// ───────────────────────── parts ─────────────────────────

function TextBox({ sceneId, text, reading, onNext }: { sceneId: string; text: string; reading: boolean; onNext(): void }): ReactNode {
  const { speaker, text: body } = splitSpeaker(text);
  return (
    <div className={reading ? 'dpc-textbox is-reading' : 'dpc-textbox'}>
      <div className="dpc-textbox-live" aria-live="polite" aria-atomic="true">
        {speaker ? <span className="dpc-nameplate">{speaker}</span> : null}
        <p className="dpc-line" key={`${sceneId}:${text}`}>
          {speaker ? <span className="visually-hidden">：</span> : null}
          {body}
        </p>
      </div>
      {reading ? (
        <button type="button" className="dpc-next" onClick={onNext} data-autofocus="">
          <span>次へ</span>
          <span className="dpc-next-mark" aria-hidden="true">
            ▼
          </span>
        </button>
      ) : null}
    </div>
  );
}

function Choices({ choices, onChoice }: { choices: readonly PcChoice[]; onChoice(next: string): void }): ReactNode {
  if (choices.length === 0) return null;
  return (
    <ul className="dpc-choices" aria-label="選択肢">
      {choices.map((c, i) => (
        <li key={`${c.next}:${c.label}`}>
          <button type="button" className="dpc-choice" onClick={() => onChoice(c.next)} data-autofocus={i === 0 ? '' : undefined}>
            {c.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

function EndingCard({
  ending,
  choices,
  onChoice,
  onEnter,
}: {
  ending: PcEnding;
  choices: readonly PcChoice[];
  onChoice(next: string): void;
  onEnter(code: string): void;
}): ReactNode {
  const link = endingLink(ending, currentAppUrl());
  const headingId = useId();
  return (
    <section className="dpc-ending" aria-labelledby={headingId}>
      <p className="dpc-ending-badge">
        <span aria-hidden="true">★ </span>
        {ending.label} に到達しました
      </p>
      <div className="dpc-ending-body">
        <div className="dpc-ending-info">
          <p className="dpc-ending-caption" id={headingId}>
            しおり帳の合言葉：
          </p>
          <p className="dpc-ending-code" translate="no">
            {ending.display}
          </p>
          <p className="dpc-ending-note">スマホのしおり帳でQRを読み取るか、合言葉を入力してください。</p>
          {link ? (
            <button type="button" className="dpc-choice dpc-choice-primary" onClick={() => onEnter(link.code)} data-autofocus="">
              この端末で入力する
            </button>
          ) : null}
        </div>
        {link ? (
          <div className="dpc-ending-qr">
            <QrCode text={link.url} label={`合言葉 ${ending.display} のQRコード`} size={148} />
          </div>
        ) : null}
      </div>
      {choices.length > 0 ? (
        <div className="dpc-ending-choices">
          {choices.map((c) => (
            <button key={`${c.next}:${c.label}`} type="button" className="dpc-choice dpc-choice-sub" onClick={() => onChoice(c.next)}>
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function TitleView({
  scene,
  door,
  title,
  art,
  onChoice,
}: {
  scene: PcScene;
  door: PcDoorInput;
  title: string;
  art: string;
  onChoice(next: string): void;
}): ReactNode {
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const inputId = useId();
  const messageId = useId();

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (value.trim() === '') {
      setMessage(DPC_DOOR_EMPTY);
      return;
    }
    if (isDoorCode(value)) {
      setValue('');
      setMessage('');
      onChoice(door.next);
      return;
    }
    setMessage(door.wrongMessage);
  };

  return (
    <div className="dpc-title">
      <p className="dpc-title-art" aria-hidden="true">
        {art}
      </p>
      <h2 className="dpc-logo">{title}</h2>
      <div className="dpc-taglines">
        {scene.lines.map((l, i) => (
          <p key={i} className="dpc-tagline">
            {l}
          </p>
        ))}
      </div>
      <div className="dpc-menu">
        {(scene.choices ?? []).map((c, i) => (
          <button
            key={`${c.next}:${c.label}`}
            type="button"
            className="dpc-choice dpc-choice-primary"
            onClick={() => onChoice(c.next)}
            data-autofocus={i === 0 ? '' : undefined}
          >
            {c.label}
          </button>
        ))}
      </div>
      <form className="dpc-door" onSubmit={onSubmit} noValidate>
        <label className="dpc-door-label" htmlFor={inputId}>
          <span aria-hidden="true">🚪 </span>
          {door.label}
        </label>
        <div className="dpc-door-row">
          <input
            id={inputId}
            className="dpc-door-input"
            type="text"
            value={value}
            placeholder={door.placeholder}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            maxLength={40}
            aria-invalid={message !== '' ? true : undefined}
            aria-describedby={messageId}
            onChange={(e) => {
              setValue(e.target.value);
              if (message !== '') setMessage('');
            }}
          />
          <button type="submit" className="dpc-choice dpc-door-btn">
            唱える
          </button>
        </div>
        <p id={messageId} className="dpc-door-msg" role="status" aria-live="polite">
          {message}
        </p>
      </form>
    </div>
  );
}
