// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { leaveLayersThen, useBackToClose } from './historyLayer';

afterEach(() => {
  cleanup();
});

function Layer({ onBack }: { onBack(): void }): ReactNode {
  useBackToClose(true, onBack);
  return <p>layer</p>;
}

function Host({ onBack }: { onBack?: () => void }): ReactNode {
  const [open, setOpen] = useState(true);
  return (
    <>
      {open ? (
        <Layer
          onBack={() => {
            onBack?.();
            setOpen(false);
          }}
        />
      ) : null}
      <button type="button" onClick={() => setOpen((o) => !o)}>
        toggle
      </button>
    </>
  );
}

function layerMarker(): unknown {
  const s = window.history.state as Record<string, unknown> | null;
  return s?.shioriLayer;
}

describe('useBackToClose', () => {
  it('pushes one marker even under StrictMode; Back closes the layer and leaves the page as it was', async () => {
    window.history.replaceState({ probe: 'page' }, '', '#/w/x');
    const onBack = vi.fn();
    const view = render(
      <StrictMode>
        <Host onBack={onBack} />
      </StrictMode>,
    );
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(layerMarker()).toBeDefined();
    act(() => window.history.back());
    await waitFor(() => expect(view.queryByText('layer')).toBeNull());
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual({ probe: 'page' });
    expect(window.location.hash).toBe('#/w/x');
  });

  it('closing from the page pops the marker again', async () => {
    window.history.replaceState({ probe: 'page2' }, '', '#/w/y');
    const view = render(<Host />);
    expect(layerMarker()).toBeDefined();
    act(() => view.getByRole('button', { name: 'toggle' }).click());
    expect(view.queryByText('layer')).toBeNull();
    await waitFor(() => expect(window.history.state).toEqual({ probe: 'page2' }));
  });

  it('leaveLayersThen pops the marker before running the navigation, without calling onBack', async () => {
    window.history.replaceState({ probe: 'page3' }, '', '#/add');
    const onBack = vi.fn();
    render(<Host onBack={onBack} />);
    expect(layerMarker()).toBeDefined();
    const seen: unknown[] = [];
    await act(
      async () =>
        new Promise<void>((resolve) =>
          leaveLayersThen(() => {
            seen.push(window.history.state);
            resolve();
          }),
        ),
    );
    expect(seen).toEqual([{ probe: 'page3' }]);
    expect(onBack).not.toHaveBeenCalled();
    // without an open layer it runs at once
    const now = vi.fn();
    leaveLayersThen(now);
    expect(now).toHaveBeenCalledTimes(1);
  });
});
