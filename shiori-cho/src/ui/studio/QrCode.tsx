import { useMemo } from 'react';
import { qrSvgPath } from './qrPng';
import './QrCode.css';

export interface QrCodeProps {
  /** Text to encode, usually an unlock URL (buildUnlockUrl). Rendered locally; nothing is sent anywhere. */
  text: string;
  /** Accessible name, e.g. 「合言葉 ST4-RMA-P1X のQRコード」. */
  label: string;
  /** Edge length in CSS px (default 192). The code shrinks to fit narrower containers. */
  size?: number;
  className?: string;
}

/**
 * On-screen QR code (EC level M) as an inline SVG: always dark modules on a white square with the 4-module
 * quiet zone, in light and dark themes alike, so phone cameras can read it from the screen.
 * If the text is too long for a QR code, a short note is shown instead.
 */
export function QrCode({ text, label, size = 192, className }: QrCodeProps) {
  const qr = useMemo(() => {
    try {
      return qrSvgPath(text);
    } catch {
      return null;
    }
  }, [text]);

  if (!qr) {
    return <p className="qrc-error">QRコードを表示できません（文字数が多すぎます）</p>;
  }
  return (
    <svg
      className={className ? `qrc ${className}` : 'qrc'}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      focusable="false"
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={qr.path} fill="#000000" />
    </svg>
  );
}
