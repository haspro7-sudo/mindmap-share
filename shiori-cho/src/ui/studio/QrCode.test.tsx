// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QrCode } from './QrCode';
import { qrSvgPath } from './qrPng';

const URL = 'http://localhost:5173/#/u/demo-hoshiyomi/ST4RMAP1X';

describe('QrCode', () => {
  afterEach(cleanup);

  it('renders the QR as an accessible inline SVG path', () => {
    const { container } = render(<QrCode text={URL} label="合言葉 ST4-RMA-P1X のQRコード" size={160} />);
    const svg = screen.getByRole('img', { name: '合言葉 ST4-RMA-P1X のQRコード' });
    const { size, path } = qrSvgPath(URL);
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${size} ${size}`);
    expect(svg.getAttribute('width')).toBe('160');
    expect(container.querySelector('path')?.getAttribute('d')).toBe(path);
    expect(container.querySelector('rect')?.getAttribute('fill')).toBe('#ffffff');
  });

  it('shows a short note instead of failing when the text is too long', () => {
    render(<QrCode text={'a'.repeat(3000)} label="QRコード" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('QRコードを表示できません（文字数が多すぎます）')).toBeTruthy();
  });
});
