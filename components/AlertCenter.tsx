'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchAlerts, markAlertsRead, type Alert } from '@/lib/db';

/**
 * 通知。未読があればカレンダーの上に赤い帯で出し、ベルから一覧を開ける。
 * 既読は2人それぞれ。一覧を開いた時点で、表示したものを既読にする。
 */
export default function AlertCenter({ version }: { version: number }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try { setAlerts(await fetchAlerts()); } catch { /* 通知が読めなくても画面は止めない */ }
  }, []);

  useEffect(() => { load(); }, [load, version]);

  const unread = alerts.filter((a) => !a.read);

  async function openList() {
    setOpen(true);
    const ids = unread.map((a) => a.id);
    if (ids.length) {
      await markAlertsRead(ids).catch(() => {});
      setAlerts((as) => as.map((a) => ({ ...a, read: true })));
    }
  }

  return (
    <>
      <button className="bell" onClick={openList} aria-label={`通知 未読${unread.length}件`}>
        <span aria-hidden="true">🔔</span> 通知
        {unread.length > 0 && <span className="bell-badge num">{unread.length}</span>}
      </button>

      {unread.length > 0 && (
        <button className="alert-banner" onClick={openList}>
          <strong>{unread[0].title}</strong>
          {unread.length > 1 && <span>（ほか{unread.length - 1}件）</span>}
          <span className="alert-banner-go">見る ›</span>
        </button>
      )}

      {open && (
        <div className="sheet" onClick={() => setOpen(false)}>
          <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2>通知</h2>
              <button onClick={() => setOpen(false)}>閉じる</button>
            </div>
            {alerts.length === 0 ? (
              <div className="empty">
                <strong>通知はまだありません</strong>
                予算を使いすぎたときや、入金日の前日にここに届きます
              </div>
            ) : (
              <div className="ledger" style={{ marginTop: 10 }}>
                {alerts.map((a) => (
                  <div className="alert-item" key={a.id}>
                    <div className="alert-item-head">
                      <span className="name">{a.title}</span>
                      <span className="sub num">{formatTime(a.created_at)}</span>
                    </div>
                    <div className="alert-item-body">{a.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
