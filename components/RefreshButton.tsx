'use client';

import { useState } from 'react';
import { runImport } from '@/lib/db';

/**
 * りそなメールの取込を手動で実行する。
 * 1時間ごとの自動取込とは別に、使った直後に押して反映させるためのもの。
 */
export default function RefreshButton({ onDone }: { onDone: (imported: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [failed, setFailed] = useState(false);

  async function run() {
    setBusy(true);
    setMsg('');
    setFailed(false);
    try {
      const r = await runImport();
      setMsg(r.imported > 0 ? `${r.imported}件 取り込みました` : '新しい明細はありませんでした');
      onDone(r.imported);
    } catch (e: any) {
      setFailed(true);
      setMsg(e?.message ?? '取込に失敗しました');
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(''), 6000);
    }
  }

  return (
    <div className="refresh">
      <button className="refresh-btn" onClick={run} disabled={busy}>
        <span className="refresh-icon" data-spin={busy}>⟳</span>
        {busy ? '取込中' : 'りそなを読み込む'}
      </button>
      {msg && <span className="refresh-msg" data-failed={failed}>{msg}</span>}
    </div>
  );
}
