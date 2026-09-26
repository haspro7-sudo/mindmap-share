// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHtmlFlag, useToastLift } from './toastLift';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Bar({ active = true }: { active?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useToastLift(ref, active);
  return <div ref={ref}>バー</div>;
}

function Flag({ name }: { name: string }) {
  useHtmlFlag(name, true);
  return null;
}

describe('toast offsets without :has()', () => {
  it('a sticky bar publishes its height (+ a gap) as --toast-lift while mounted', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 66 } as DOMRect);
    const root = document.documentElement;
    const view = render(<Bar />);
    expect(root.style.getPropertyValue('--toast-lift')).toBe('76px');
    view.rerender(<Bar active={false} />);
    expect(root.style.getPropertyValue('--toast-lift')).toBe('');
    view.rerender(<Bar />);
    view.unmount();
    expect(root.style.getPropertyValue('--toast-lift')).toBe('');
  });

  it('useHtmlFlag keeps the attribute while any user is mounted', () => {
    const root = document.documentElement;
    const a = render(<Flag name="sheet-open" />);
    const b = render(<Flag name="sheet-open" />);
    expect(root.hasAttribute('data-sheet-open')).toBe(true);
    a.unmount();
    expect(root.hasAttribute('data-sheet-open')).toBe(true);
    b.unmount();
    expect(root.hasAttribute('data-sheet-open')).toBe(false);
  });
});
