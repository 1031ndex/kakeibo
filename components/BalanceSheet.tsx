'use client';

import { useEffect, useState } from 'react';
import { adjustBalance, fetchBalanceOn, yen } from '@/lib/db';

/**
 * 通帳の残高に合わせる。
 * アプリを始める前のお金や、取り込めていない入出金を、差額としてまとめて埋める。
 */
export default function BalanceSheet({ onClose, onSaved }: {
  onClose: () => void; onSaved: () => void;
}) {
  const [appBalance, setAppBalance] = useState<number | null>(null);
  const [actual, setActual] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchBalanceOn(new Date())
      .then(setAppBalance)
      .catch((e) => setError(e.message ?? '読み込めませんでした'));
  }, []);

  const diff = actual === '' || appBalance === null ? null : Number(actual) - appBalance;

  async function save() {
    if (actual === '') { setError('通帳の残高を入れてください'); return; }
    setBusy(true);
    try {
      await adjustBalance(Number(actual), new Date());
      onSaved();
    } catch (e: any) {
      setError(e.message ?? '保存できませんでした');
      setBusy(false);
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>通帳の残高と合わせる</h2>
          <button onClick={onClose}>閉じる</button>
        </div>

        <p className="figure-sub" style={{ marginTop: 8 }}>
          先にカレンダーの「りそなを読み込む」を押して、今日までの明細を入れておいてください。
          そのうえで、りそなアプリやATMで見た<strong>今の残高</strong>を入れると、差額を「残高調整」として記録します。
        </p>

        <div className="settle">
          <div className="settle-name">アプリ上の今日の残高</div>
          <div className="settle-pay">{appBalance === null ? '…' : `${yen(appBalance)} 円`}</div>
        </div>

        <div className="field">
          <label htmlFor="ab">通帳の今の残高</label>
          <input id="ab" type="number" inputMode="numeric" value={actual}
            onChange={(e) => setActual(e.target.value)} placeholder="150000" />
        </div>

        {diff !== null && (
          <p className="figure-sub" style={{ marginTop: 8 }}>
            {diff === 0
              ? 'ぴったり合っています。記録は不要です。'
              : `${diff > 0 ? '+' : '−'}${yen(Math.abs(diff))} 円を今日の日付で記録します。`}
          </p>
        )}

        {error && <p className="error">{error}</p>}

        <div style={{ marginTop: 18 }}>
          <button className="btn" onClick={save} disabled={busy || diff === 0}>
            {busy ? '保存中' : '残高を合わせる'}
          </button>
        </div>
      </div>
    </div>
  );
}
