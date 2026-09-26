// #/add 作品を追加 (docs/SPEC.md F5 AC1–AC2, F6, F4 AC1, F17 AC1): four entries —
// しおりファイルを読み込む (file picker, drag & drop, paste → ImportPreview), かんたんしおりを作る (QuickPackForm),
// 記録だけ付ける (ManualWorkForm) and サンプルを試す. The sub-views are component state, never routes.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { readClipboard, readFileAsText } from '../../app/platform';
import { MAX_MANIFEST_BYTES } from '../../core/constants';
import { utf8ByteLength } from '../../core/manifest/validate';
import { useLatest } from '../components/useLatest';
import { useUi } from '../context';
import { navigate } from '../router';
import { FocusHeading } from './AddWorkFields';
import { ImportPreview } from './ImportPreview';
import { MSG_FILE_TOO_LARGE, errorMessageJa, useTrySamples } from './libraryShared';
import { ManualWorkForm } from './ManualWorkForm';
import { QuickPackForm } from './QuickPackForm';
import './AddWork.css';

type View =
  | { name: 'menu' }
  | { name: 'preview'; text: string; source: 'file' | 'paste' }
  | { name: 'quick' }
  | { name: 'manual' };

const MSG_PASTE_EMPTY = 'しおりファイルの内容を貼り付けてください';
const MSG_CLIPBOARD = 'クリップボードを読めませんでした。入力欄を長押しして貼り付けてください';

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

export function AddWorkScreen(): ReactNode {
  const [view, setView] = useState<View>({ name: 'menu' });
  /** paste text survives a round trip to the preview and back */
  const [pasteText, setPasteText] = useState('');
  /** true once a sub-view was closed: the menu heading then takes focus again */
  const [returned, setReturned] = useState(false);
  const toMenu = useCallback(() => {
    setView({ name: 'menu' });
    setReturned(true);
  }, []);

  let body: ReactNode;
  switch (view.name) {
    case 'preview':
      body = <ImportPreview text={view.text} source={view.source} onCancel={toMenu} />;
      break;
    case 'quick':
      body = <QuickPackForm onCancel={toMenu} />;
      break;
    case 'manual':
      body = <ManualWorkForm onCancel={toMenu} />;
      break;
    case 'menu':
      body = (
        <AddMenu
          focusHeading={returned}
          pasteText={pasteText}
          onPasteTextChange={setPasteText}
          onPreview={(text, source) => setView({ name: 'preview', text, source })}
          onQuick={() => setView({ name: 'quick' })}
          onManual={() => setView({ name: 'manual' })}
        />
      );
      break;
  }

  return (
    <main className="screen aw" data-view={view.name}>
      {body}
    </main>
  );
}

// ───────────────────────── menu ─────────────────────────

interface AddMenuProps {
  focusHeading: boolean;
  pasteText: string;
  onPasteTextChange(text: string): void;
  onPreview(text: string, source: 'file' | 'paste'): void;
  onQuick(): void;
  onManual(): void;
}

function AddMenu({ focusHeading, pasteText, onPasteTextChange, onPreview, onQuick, onManual }: AddMenuProps): ReactNode {
  const ui = useUi();
  const trySamples = useTrySamples();
  const fileRef = useRef<HTMLInputElement>(null);
  const pasteId = useId();
  const [fileError, setFileError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(pasteText !== '');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [samplesBusy, setSamplesBusy] = useState(false);
  const onPreviewRef = useLatest(onPreview);

  const openFile = useCallback(async (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    // F5 AC2: too large → rejected before anything is read.
    if (file.size > MAX_MANIFEST_BYTES) {
      setFileError(MSG_FILE_TOO_LARGE);
      return;
    }
    setReading(true);
    try {
      const text = await readFileAsText(file);
      onPreviewRef.current(text, 'file');
    } catch (e) {
      setFileError(errorMessageJa(e));
      setReading(false);
    }
  }, [onPreviewRef]);

  // Drag & drop anywhere on the page (desktop). Dropping a file outside a drop zone would otherwise
  // make the browser navigate away from the app to show the file.
  useEffect(() => {
    let depth = 0;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      void openFile(e.dataTransfer?.files[0]);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [openFile]);

  const submitPaste = () => {
    const text = pasteText;
    if (text.trim() === '') {
      setPasteError(MSG_PASTE_EMPTY);
      return;
    }
    if (text.length > MAX_MANIFEST_BYTES || utf8ByteLength(text) > MAX_MANIFEST_BYTES) {
      setPasteError(MSG_FILE_TOO_LARGE);
      return;
    }
    setPasteError(null);
    onPreview(text, 'paste');
  };

  const pasteFromClipboard = async () => {
    const text = await readClipboard();
    if (text === null || text.trim() === '') {
      ui.toast(MSG_CLIPBOARD);
      return;
    }
    onPasteTextChange(text);
    setPasteError(null);
  };

  const onSamples = async () => {
    setSamplesBusy(true);
    const ok = await trySamples();
    setSamplesBusy(false);
    if (ok) navigate({ name: 'home' }, { replace: true });
  };

  return (
    <div className="aw-menu stack">
      <FocusHeading autoFocus={focusHeading}>作品を追加</FocusHeading>

      <section className={`card aw-import${dragging ? ' is-dragging' : ''}`} aria-labelledby="aw-import-title">
        <div className="aw-entry-head">
          <span className="aw-entry-icon" aria-hidden="true">
            📄
          </span>
          <div className="aw-entry-text">
            <h2 id="aw-import-title" className="aw-entry-title">
              しおりファイルを読み込む
            </h2>
            <p className="aw-entry-desc">作品に同梱された「shiori.json」を選ぶと、目標や合言葉が使えるようになります。</p>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            void openFile(file);
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => fileRef.current?.click()}
          disabled={reading}
          aria-busy={reading}
        >
          ファイルを選ぶ
        </button>
        <p className="aw-drop-hint" aria-hidden={!dragging}>
          {dragging ? 'ここで離すと読み込みます' : 'ファイルをドロップしても読み込めます'}
        </p>
        {fileError ? (
          <p className="field-error aw-error" role="alert">
            {fileError}
          </p>
        ) : null}

        <div className="aw-paste">
          <button
            type="button"
            className="btn btn-ghost aw-paste-toggle"
            aria-expanded={pasteOpen}
            aria-controls={`${pasteId}-panel`}
            onClick={() => setPasteOpen((o) => !o)}
          >
            <span>テキストを貼り付けて読み込む</span>
            <span aria-hidden="true" className="aw-chev">
              {pasteOpen ? '▴' : '▾'}
            </span>
          </button>
          <div id={`${pasteId}-panel`} className="aw-paste-panel stack-sm" hidden={!pasteOpen}>
            <div className="aw-paste-labelrow">
              <label htmlFor={pasteId} className="field-label">
                しおりファイルの内容
              </label>
              <button type="button" className="btn btn-sm" onClick={() => void pasteFromClipboard()}>
                貼り付け
              </button>
            </div>
            <textarea
              id={pasteId}
              className="textarea aw-paste-text mono"
              value={pasteText}
              onChange={(e) => {
                onPasteTextChange(e.target.value);
                if (pasteError) setPasteError(null);
              }}
              placeholder={'{ "schema": "shiori/1", … }'}
              rows={5}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              aria-invalid={pasteError ? true : undefined}
              aria-describedby={pasteError ? `${pasteId}-error` : `${pasteId}-hint`}
            />
            {pasteError ? (
              <p id={`${pasteId}-error`} className="field-error aw-error" role="alert">
                {pasteError}
              </p>
            ) : (
              <p id={`${pasteId}-hint`} className="field-hint">
                サークルが公開しているテキストをそのまま貼り付けてください（512KBまで）。
              </p>
            )}
            <button type="button" className="btn btn-block" onClick={submitPaste}>
              内容を確かめる
            </button>
          </div>
        </div>
      </section>

      <ul className="aw-entries">
        <li>
          <button
            type="button"
            className="card aw-entry"
            onClick={onQuick}
            aria-labelledby="aw-quick-title"
            aria-describedby="aw-quick-desc"
          >
            <span className="aw-entry-icon" aria-hidden="true">
              ✅
            </span>
            <span className="aw-entry-text">
              <span id="aw-quick-title" className="aw-entry-title">
                かんたんしおりを作る
              </span>
              <span id="aw-quick-desc" className="aw-entry-desc">
                エンディングやCGの数を入れるだけで、チェックリストを作ります。
              </span>
            </span>
            <span className="aw-entry-chev" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="card aw-entry"
            onClick={onManual}
            aria-labelledby="aw-manual-title"
            aria-describedby="aw-manual-desc"
          >
            <span className="aw-entry-icon" aria-hidden="true">
              📝
            </span>
            <span className="aw-entry-text">
              <span id="aw-manual-title" className="aw-entry-title">
                記録だけ付ける
              </span>
              <span id="aw-manual-desc" className="aw-entry-desc">
                しおりファイルなしで、プレイ記録・前回の続き・メモを残します。
              </span>
            </span>
            <span className="aw-entry-chev" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className="card aw-entry"
            onClick={() => void onSamples()}
            aria-labelledby="aw-samples-title"
            aria-describedby="aw-samples-desc"
            disabled={samplesBusy}
            aria-busy={samplesBusy}
          >
            <span className="aw-entry-icon" aria-hidden="true">
              🔖
            </span>
            <span className="aw-entry-text">
              <span id="aw-samples-title" className="aw-entry-title">
                サンプルを試す
              </span>
              <span id="aw-samples-desc" className="aw-entry-desc">
                架空の作品2本で、ヒントや合言葉、おまけの開き方を試せます。
              </span>
            </span>
            <span className="aw-entry-chev" aria-hidden="true">
              ›
            </span>
          </button>
        </li>
      </ul>
    </div>
  );
}
