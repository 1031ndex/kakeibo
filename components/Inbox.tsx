'use client';

import { useEffect, useState } from 'react';
import {
  fetchUnclassified, fetchCategories, classify, learnRule,
  yen, type Tx, type Category,
} from '@/lib/db';

export default function Inbox({ onDone }: { onDone: () => void }) {
  const [queue, setQueue] = useState<Tx[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [learn, setLearn] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [q, c] = await Promise.all([fetchUnclassified(), fetchCategories()]);
        setQueue(q);
        setCats(c.filter((x) => x.kind !== '収入'));
      } catch (e: any) {
        setError(e.message ?? '読み込めませんでした');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current = queue[0];

  async function pick(cat: Category) {
    if (!current) return;
    try {
      await classify(current.id, cat.id, cat.pocket_id);
      if (learn && current.merchant) await learnRule(current.merchant, cat.id);
      setQueue((q) => q.slice(1));
      onDone();
    } catch (e: any) {
      setError(e.message ?? '登録できませんでした');
    }
  }

  if (loading) return <div className="empty">読み込み中</div>;

  if (!current) {
    return (
      <>
        <header className="topbar"><h1>未分類</h1></header>
        <div className="empty">
          <strong>すべて振り分けました</strong>
          新しい明細が届いたらここに並びます
        </div>
      </>
    );
  }

  const d = new Date(current.occurred_at);

  return (
    <>
      <header className="topbar">
        <h1>未分類</h1>
        <span className="month-label num">残り {queue.length} 件</span>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="slip">
        <div className="slip-store">{current.merchant || '（店名なし）'}</div>
        <div className="slip-meta num">
          {d.getFullYear()}/{d.getMonth() + 1}/{d.getDate()} {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
          {current.is_refund && '　返金'}
        </div>
        <div className="slip-amount num" style={current.amount < 0 ? { color: 'var(--midori)' } : undefined}>
          {yen(current.amount)} 円
        </div>
      </div>

      <p className="eyebrow">カテゴリを選ぶ</p>
      <div className="cats">
        {cats.map((c) => (
          <button key={c.id} onClick={() => pick(c)}>{c.name}</button>
        ))}
      </div>

      <label className="learn">
        <input type="checkbox" checked={learn} onChange={(e) => setLearn(e.target.checked)} />
        今後「{current.merchant || 'この店'}」は自動で同じカテゴリにする
      </label>
    </>
  );
}
