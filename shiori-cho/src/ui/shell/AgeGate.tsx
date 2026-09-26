// F1: the age gate. Only this renders until ageConfirmedAt is set (the shell reads no work data).
// 「いいえ」 is a dead end (nothing is stored, so a reload shows the gate again). It is a self-declaration.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { BrandMark } from './BrandMark';
import './gate.css';
import './AgeGate.css';

export const AGE_GATE_QUESTION =
  'このアプリは18歳以上の方を対象とする作品の記録にも使われます。あなたは18歳以上ですか？';

export function AgeGate({ onConfirm }: { onConfirm(): void }): ReactNode {
  const [declined, setDeclined] = useState(false);

  if (declined) {
    return (
      <main className="gate" data-shell="age-gate-declined">
        <div className="gate-card ag-declined" role="alert">
          <div className="gate-brand">
            <BrandMark />
            <span>しおり帳</span>
          </div>
          <h1 className="gate-title">このアプリはご利用いただけません</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="gate" data-shell="age-gate">
      <div className="gate-card">
        <div className="gate-brand">
          <BrandMark />
          <span>しおり帳</span>
        </div>
        <h1 className="gate-title">年齢の確認</h1>
        <p className="gate-lead">{AGE_GATE_QUESTION}</p>
        <div className="gate-actions">
          <button type="button" className="btn btn-primary btn-block" onClick={onConfirm}>
            はい、18歳以上です
          </button>
          <button type="button" className="btn btn-block" onClick={() => setDeclined(true)}>
            いいえ
          </button>
        </div>
        <p className="gate-note">この確認は自己申告です。回答はこの端末の中にだけ保存されます。</p>
      </div>
    </main>
  );
}
