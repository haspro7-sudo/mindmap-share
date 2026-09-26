/**
 * Provides UiContext (see UiApi in ../context.tsx):
 * - toast(): a polite live region, stacked (max 3), auto-dismiss 3 s / 5 s with an action (paused while
 *   hovered or focused), one action button such as 「元に戻す」.
 * - confirm() / prompt(): one modal dialog at a time (role="dialog", focus trap, Escape / backdrop cancels,
 *   danger styling, prompt validation).
 * - queueEnvelopes(): sealed extras shown one by one — EnvelopeReveal (≤1.5 s, tap to skip, 200 ms fade with
 *   prefers-reduced-motion, vibrate(30)) and then a Sheet with <SealedReader>; closing the reader stores
 *   SealedOpen.seen = true.
 * - hide() / lockNow(): forwarded to the shell (onHide / onLock). Every dialog, sheet and the envelope show
 *   their own 「隠す」 (they cover the header's), and Escape on the envelope hides too.
 *
 * `suspended` (camouflage / lock screen): when it turns on, open dialogs are cancelled (confirm → false,
 * prompt → null) and toasts are cleared before the next paint, so nothing from the app stays on screen;
 * envelopes wait until it turns off. Async work of the app that finishes while suspended (an export, an
 * import, a code check that was running when the app locked or was hidden) cannot put anything on screen
 * either: its toasts are dropped and its confirm / prompt requests resolve as cancelled at once. Only the
 * lock screen's own toasts and questions pass (`whileSuspended: true`).
 * `camouflaged` (the 「メモ」 notepad): nothing at all appears over it, whatever the options.
 *
 * Route changes (browser / hardware Back, a link): dialogs requested on another route are cancelled
 * (confirm → false, prompt → null), so they never act on a screen that is gone; the envelope overlay closes
 * (a reader that was on screen is marked seen; the rest stay unseen and replay from the おまけ tab).
 *
 * Envelopes read from the RepoContext above this provider. A screen that hosts the player UI on another
 * repository (studio preview) should nest its own <UiProvider onHide={ui.hide} onLock={ui.lockNow}>
 * inside that RepoContext.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { vibrate } from '../../app/platform';
import { loadWorkManifest } from '../../app/unlock';
import { isShioriError } from '../../core/errors';
import { EnvelopeReveal } from '../components/EnvelopeReveal';
import { HideButton } from '../components/HideButton';
import { useFocusTrap, useOverlayLayer } from '../components/overlay';
import { useLatest } from '../components/useLatest';
import { SealedReader } from '../components/SealedReader';
import { Sheet } from '../components/Sheet';
import { UiContext, useRepo, useRepoQuery } from '../context';
import type { ConfirmOptions, PromptOptions, ToastOptions, UiApi } from '../context';
import { subscribeRouteChange } from '../router';
import './UiProvider.css';

export interface UiProviderProps {
  children: ReactNode;
  onHide(): void;
  onLock(): void;
  /** true while the camouflage or lock screen is shown (see the module comment) */
  suspended?: boolean;
  /** true while the camouflage notepad is shown (implies `suspended`; see the module comment) */
  camouflaged?: boolean;
}

const MAX_TOASTS = 3;
const TOAST_MS = 3000;
const TOAST_ACTION_MS = 5000;

interface ToastItem {
  id: number;
  message: string;
  tone: NonNullable<ToastOptions['tone']>;
  action?: ToastOptions['action'];
  durationMs: number;
  whileSuspended: boolean;
}

/** `hash`: the route the dialog was requested on (it is cancelled when the route changes). */
type DialogRequest =
  | { id: number; kind: 'confirm'; hash: string; opts: ConfirmOptions; resolve(v: boolean): void }
  | { id: number; kind: 'prompt'; hash: string; opts: PromptOptions; resolve(v: string | null): void };

function cancelDialog(d: DialogRequest): void {
  if (d.kind === 'confirm') d.resolve(false);
  else d.resolve(null);
}

function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

interface EnvelopeItem {
  workId: string;
  sealedId: string;
}

const envelopeKey = (e: EnvelopeItem) => `${e.workId}\u0000${e.sealedId}`;

export function UiProvider({ children, onHide, onLock, suspended = false, camouflaged = false }: UiProviderProps): ReactNode {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialogs, setDialogs] = useState<DialogRequest[]>([]);
  const [envelopes, setEnvelopes] = useState<EnvelopeItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const onHideRef = useLatest(onHide);
  const onLockRef = useLatest(onLock);
  const camouflagedRef = useLatest(camouflaged);
  const suspendedRef = useLatest(suspended);
  const dialogsRef = useLatest(dialogs);
  /** false when nothing may be shown now for a request with these options (see the module comment) */
  const mayShow = useCallback(
    (opts: { whileSuspended?: boolean }) => !camouflagedRef.current && (!suspendedRef.current || opts.whileSuspended === true),
    [camouflagedRef, suspendedRef],
  );

  const clearTimer = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const dismissToast = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((ts) => ts.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const startTimer = useCallback(
    (id: number, ms: number) => {
      clearTimer(id);
      timers.current.set(
        id,
        setTimeout(() => dismissToast(id), ms),
      );
    },
    [clearTimer, dismissToast],
  );

  const toast = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      // Nothing of the app may show over the 「メモ」 notepad or the lock screen (e.g. an export that finished
      // after 「隠す」), except the lock screen's own messages.
      if (!mayShow(opts)) return;
      const id = ++nextId.current;
      const durationMs = opts.durationMs ?? (opts.action ? TOAST_ACTION_MS : TOAST_MS);
      const item: ToastItem = {
        id,
        message,
        tone: opts.tone ?? 'default',
        action: opts.action,
        durationMs,
        whileSuspended: opts.whileSuspended === true,
      };
      setToasts((ts) => {
        const next = [...ts, item];
        for (const dropped of next.slice(0, Math.max(0, next.length - MAX_TOASTS))) clearTimer(dropped.id);
        return next.slice(-MAX_TOASTS);
      });
      startTimer(id, durationMs);
    },
    [clearTimer, startTimer, mayShow],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        if (!mayShow(opts)) {
          resolve(false);
          return;
        }
        const id = ++nextId.current;
        setDialogs((ds) => [...ds, { id, kind: 'confirm', hash: currentHash(), opts, resolve }]);
      }),
    [mayShow],
  );

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        if (!mayShow(opts)) {
          resolve(null);
          return;
        }
        const id = ++nextId.current;
        setDialogs((ds) => [...ds, { id, kind: 'prompt', hash: currentHash(), opts, resolve }]);
      }),
    [mayShow],
  );

  const queueEnvelopes = useCallback((items: ReadonlyArray<EnvelopeItem>) => {
    if (items.length === 0) return;
    setEnvelopes((q) => {
      const seen = new Set(q.map(envelopeKey));
      const next = [...q];
      for (const it of items) {
        const k = envelopeKey(it);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ workId: it.workId, sealedId: it.sealedId });
      }
      return next;
    });
  }, []);

  const api = useMemo<UiApi>(
    () => ({
      toast,
      confirm,
      prompt,
      queueEnvelopes,
      hide: () => onHideRef.current(),
      lockNow: () => onLockRef.current(),
      isCamouflaged: () => camouflagedRef.current,
    }),
    [toast, confirm, prompt, queueEnvelopes, onHideRef, onLockRef, camouflagedRef],
  );

  // Entering the camouflage / lock screen: drop everything the app had on screen before the next paint.
  // While suspended, a dialog that is not allowed then (see mayShow) is cancelled as soon as it appears.
  const wasSuspended = useRef(suspended);
  const wasCamouflaged = useRef(camouflaged);
  useLayoutEffect(() => {
    const entering = (suspended && !wasSuspended.current) || (camouflaged && !wasCamouflaged.current);
    wasSuspended.current = suspended;
    wasCamouflaged.current = camouflaged;
    if (entering) {
      for (const id of [...timers.current.keys()]) clearTimer(id);
      setToasts([]);
    }
    if (!suspended && !camouflaged) return;
    const stale = dialogs.filter((d) => entering || camouflaged || d.opts.whileSuspended !== true);
    if (stale.length === 0) return;
    const ids = new Set(stale.map((d) => d.id));
    setDialogs((ds) => ds.filter((d) => !ids.has(d.id)));
    for (const d of stale) cancelDialog(d);
  }, [suspended, camouflaged, dialogs, clearTimer]);

  // The route changed (Back, a link): dialogs asked for on another route no longer apply.
  useEffect(
    () =>
      subscribeRouteChange(() => {
        const hash = currentHash();
        const stale = dialogsRef.current.filter((d) => d.hash !== hash);
        if (stale.length === 0) return;
        const ids = new Set(stale.map((d) => d.id));
        setDialogs((ds) => ds.filter((d) => !ids.has(d.id)));
        for (const d of stale) cancelDialog(d);
      }),
    [dialogsRef],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const closeDialog = useCallback((req: DialogRequest, value: boolean | string | null) => {
    setDialogs((ds) => ds.filter((d) => d.id !== req.id));
    if (req.kind === 'confirm') req.resolve(value === true);
    else req.resolve(typeof value === 'string' ? value : null);
  }, []);

  const currentDialog = suspended ? dialogs.find((d) => d.opts.whileSuspended === true) : dialogs[0];
  const shownToasts = suspended ? toasts.filter((t) => t.whileSuspended) : toasts;
  const currentEnvelope = envelopes[0];
  const finishEnvelope = useCallback((item: EnvelopeItem) => {
    setEnvelopes((q) => q.filter((e) => envelopeKey(e) !== envelopeKey(item)));
  }, []);
  const dropEnvelopes = useCallback(() => setEnvelopes([]), []);
  const hideFromOverlay = useCallback(() => onHideRef.current(), [onHideRef]);

  const portal = (node: ReactNode) => (typeof document === 'undefined' ? null : createPortal(node, document.body));

  return (
    <UiContext.Provider value={api}>
      {children}
      {!suspended && currentEnvelope ? (
        <EnvelopeHost
          key={envelopeKey(currentEnvelope)}
          item={currentEnvelope}
          onFinished={finishEnvelope}
          onLeave={dropEnvelopes}
          onHide={hideFromOverlay}
          toast={toast}
        />
      ) : null}
      {currentDialog && !camouflaged ? (
        <DialogView key={currentDialog.id} req={currentDialog} onClose={closeDialog} onHide={hideFromOverlay} />
      ) : null}
      {camouflaged ? null : portal(
        <div className="ui-toasts" role="status" aria-live="polite" aria-relevant="additions text">
          {shownToasts.map((t) => (
            <div
              key={t.id}
              className={`ui-toast ui-toast-${t.tone}`}
              onPointerEnter={() => clearTimer(t.id)}
              onPointerLeave={() => startTimer(t.id, t.durationMs)}
              onFocus={() => clearTimer(t.id)}
              onBlur={() => startTimer(t.id, t.durationMs)}
            >
              {t.tone === 'danger' ? (
                <span className="ui-toast-icon" aria-hidden="true">
                  !
                </span>
              ) : t.tone === 'ok' ? (
                <span className="ui-toast-icon" aria-hidden="true">
                  ✓
                </span>
              ) : null}
              <span className="ui-toast-msg">{t.message}</span>
              {t.action ? (
                <button
                  type="button"
                  className="ui-toast-action"
                  onClick={() => {
                    const action = t.action;
                    dismissToast(t.id);
                    action?.onClick();
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
              <button type="button" className="ui-toast-close" aria-label="閉じる" onClick={() => dismissToast(t.id)}>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                  <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
                </svg>
              </button>
            </div>
          ))}
        </div>,
      )}
    </UiContext.Provider>
  );
}

// ───────────────────────── dialogs ─────────────────────────

function DialogView({
  req,
  onClose,
  onHide,
}: {
  req: DialogRequest;
  onClose(req: DialogRequest, value: boolean | string | null): void;
  onHide(): void;
}): ReactNode {
  const titleId = useId();
  const bodyId = useId();
  const inputId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const opts = req.opts;
  const isPrompt = req.kind === 'prompt';
  const [value, setValue] = useState(isPrompt ? (req.opts.initialValue ?? '') : '');
  const [error, setError] = useState<string | null>(null);

  const cancel = () => onClose(req, isPrompt ? null : false);
  useOverlayLayer(true, cancel);
  useFocusTrap(panelRef, true, isPrompt ? inputRef : opts.danger ? cancelRef : okRef);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (req.kind === 'prompt') {
      const err = req.opts.validate?.(value) ?? null;
      if (err) {
        setError(err);
        inputRef.current?.focus();
        return;
      }
      onClose(req, value);
    } else {
      onClose(req, true);
    }
  };

  return createPortal(
    <div className="ui-dialog-root">
      <div className="ui-dialog-backdrop" aria-hidden="true" onClick={cancel} />
      <div
        ref={panelRef}
        className={`ui-dialog${opts.danger ? ' is-danger' : ''}`}
        role={opts.danger ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={opts.body ? bodyId : undefined}
        tabIndex={-1}
      >
        <form onSubmit={submit} noValidate>
          <h2 id={titleId} className="ui-dialog-title">
            {opts.title}
          </h2>
          {opts.body ? (
            <p id={bodyId} className="ui-dialog-body pre">
              {opts.body}
            </p>
          ) : null}
          {req.kind === 'prompt' ? (
            <div className="field ui-dialog-field">
              <label htmlFor={inputId}>{req.opts.label}</label>
              <input
                ref={inputRef}
                id={inputId}
                className="input"
                type={req.opts.inputType ?? 'text'}
                value={value}
                autoComplete="off"
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(req.opts.validate?.(e.target.value) ?? null);
                }}
              />
              {error ? (
                <p id={errorId} className="field-error" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="ui-dialog-actions">
            <button ref={cancelRef} type="button" className="btn" onClick={cancel}>
              {opts.cancelLabel ?? 'キャンセル'}
            </button>
            <button ref={okRef} type="submit" className={`btn ${opts.danger ? 'ui-btn-danger' : 'btn-primary'}`}>
              {opts.okLabel ?? 'OK'}
            </button>
          </div>
        </form>
        {/* the dialog covers the header's 「隠す」: its own keeps hiding a single tap (after the form in tab order) */}
        <HideButton onHide={onHide} className="btn-ghost ui-dialog-hide" />
      </div>
    </div>,
    document.body,
  );
}

// ───────────────────────── envelopes ─────────────────────────

function EnvelopeHost({
  item,
  onFinished,
  onLeave,
  onHide,
  toast,
}: {
  item: EnvelopeItem;
  onFinished(item: EnvelopeItem): void;
  /** drop the whole queue: the route changed (see the module comment) */
  onLeave(): void;
  onHide(): void;
  toast: UiApi['toast'];
}): ReactNode {
  const repo = useRepo();
  const [phase, setPhase] = useState<'anim' | 'reader'>('anim');
  /** the route the envelope opened on */
  const [startHash] = useState(currentHash);
  const phaseRef = useLatest(phase);
  const info = useRepoQuery(
    async (r) => {
      const wm = await loadWorkManifest(r, item.workId);
      const s = wm?.record.manifest.sealed.find((x) => x.id === item.sealedId);
      return s ? { label: s.label, kind: s.kind } : null;
    },
    [item.workId, item.sealedId],
  );

  useEffect(() => {
    vibrate(30);
  }, []);

  const markSeen = async () => {
    try {
      const opens = await repo.listSealedOpens(item.workId);
      const existing = opens.find((o) => o.sealedId === item.sealedId);
      await repo.putSealedOpen(
        existing
          ? { ...existing, seen: true }
          : { workId: item.workId, sealedId: item.sealedId, firstOpenedAt: Date.now(), seen: true },
      );
    } catch (e) {
      toast(isShioriError(e) ? e.messageJa : '保存できませんでした', { tone: 'danger' });
    }
  };
  const markSeenRef = useLatest(markSeen);

  const close = () => {
    onFinished(item);
    void markSeen();
  };

  // Back / a link while the envelope is up: close it instead of leaving it over another page.
  useEffect(() => {
    const check = () => {
      if (currentHash() === startHash) return;
      if (phaseRef.current === 'reader') void markSeenRef.current();
      onLeave();
    };
    check();
    return subscribeRouteChange(check);
  }, [startHash, onLeave, phaseRef, markSeenRef]);

  if (phase === 'anim') {
    return <EnvelopeReveal kind={info.data?.kind} label={info.data?.label} onDone={() => setPhase('reader')} onHide={onHide} />;
  }
  return (
    <Sheet open onClose={close} title="おまけが届きました">
      <SealedReader workId={item.workId} sealedId={item.sealedId} />
    </Sheet>
  );
}
