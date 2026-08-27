'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ACCOUNT, fetchMonthTx, fetchYearTx, fetchTrend,
  yen, monthLabel, type Tx,
} from '@/lib/db';

// 色は共通りそなのカテゴリ数に合わせて用意する
const COLORS = [
  '#27546E', '#3D8AA8', '#5FA88C', '#8CB863', '#C9A227',
  '#C4703A', '#B23A2E', '#8E5572', '#6B6BA8', '#767F87',
];

export default function Chart() {
  const [span, setSpan] = useState<'month' | 'year'>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [txs, setTxs] = useState<Tx[]>([]);
  const [trend, setTrend] = useState<{ month: string; income: number; outgo: number }[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async (s: 'month' | 'year', c: Date) => {
    try {
      const [t, tr] = await Promise.all([
        s === 'month'
          ? fetchMonthTx(ACCOUNT.RESONA, c)
          : fetchYearTx(ACCOUNT.RESONA, c.getFullYear()),
        fetchTrend(ACCOUNT.RESONA, 12),
      ]);
      setTxs(t); setTrend(tr); setError('');
    } catch (e: any) {
      setError(e.message ?? '読み込めませんでした');
    }
  }, []);

  useEffect(() => { load(span, cursor); }, [span, cursor, load]);

  const shift = (n: number) =>
    setCursor((c) => span === 'month'
      ? new Date(c.getFullYear(), c.getMonth() + n, 1)
      : new Date(c.getFullYear() + n, 0, 1));

  // カテゴリ別に集計（支出のみ）
  const byCat = new Map<string, number>();
  for (const t of txs) {
    if (t.type !== '支出') continue;
    const n = t.categories?.name ?? '未分類';
    byCat.set(n, (byCat.get(n) ?? 0) + t.amount);
  }
  const items = Array.from(byCat.entries())
    .map(([name, value]) => ({ name, value }))
    .filter((i) => i.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = items.reduce((s, i) => s + i.value, 0);

  return (
    <>
      <header className="topbar">
        <h1>グラフ</h1>
        <div className="month-nav">
          <button onClick={() => shift(-1)} aria-label="前へ">‹</button>
          <span className="month-label num">
            {span === 'month' ? monthLabel(cursor) : `${cursor.getFullYear()}年`}
          </span>
          <button onClick={() => shift(1)} aria-label="次へ">›</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="seg">
        <button data-on={span === 'month'} onClick={() => setSpan('month')}>月</button>
        <button data-on={span === 'year'} onClick={() => setSpan('year')}>年</button>
      </div>

      {total === 0 ? (
        <div className="empty">
          <strong>この期間の支出はありません</strong>
          デビットを使うとここに集計されます
        </div>
      ) : (
        <>
          <Donut items={items} total={total} />

          <div className="ledger" style={{ marginTop: 14 }}>
            {items.map((it, i) => (
              <div className="list-row" key={it.name}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <i style={{
                    width: 10, height: 10, borderRadius: 5,
                    background: COLORS[i % COLORS.length], display: 'inline-block',
                  }} />
                  <span className="name">{it.name}</span>
                </span>
                <span>
                  <span className="row-amount num">{yen(it.value)}</span>
                  <span className="sub num" style={{ marginLeft: 8 }}>
                    {Math.round((it.value / total) * 100)}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="eyebrow">支出の推移（直近12か月）</p>
      <Trend rows={trend} />
    </>
  );
}

/** ドーナツグラフ。SVGの円弧を使って描く */
function Donut({ items, total }: { items: { name: string; value: number }[]; total: number }) {
  const size = 220;
  const r = 84;
  const stroke = 34;
  const c = 2 * Math.PI * r;

  let offset = 0;
  const arcs = items.map((it, i) => {
    const len = (it.value / total) * c;
    const seg = { len, offset, color: COLORS[i % COLORS.length] };
    offset += len;
    return seg;
  });

  return (
    <div style={{ display: 'grid', placeItems: 'center', marginTop: 16 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label="カテゴリ別の支出割合">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {arcs.map((a, i) => (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={stroke}
              strokeDasharray={`${a.len} ${c - a.len}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </g>
        <text x={size / 2} y={size / 2 - 6} textAnchor="middle"
          style={{ fontSize: 11, fill: 'var(--ink-3)', letterSpacing: '0.08em' }}>
          支出合計
        </text>
        <text x={size / 2} y={size / 2 + 18} textAnchor="middle"
          style={{ fontSize: 21, fontWeight: 600, fill: 'var(--ink)', fontFamily: 'var(--mono)' }}>
          {yen(total)}
        </text>
      </svg>
    </div>
  );
}

/** 月次推移。棒の高さで比べる */
function Trend({ rows }: { rows: { month: string; income: number; outgo: number }[] }) {
  if (rows.length === 0) {
    return <div className="empty">まだ推移を出せるデータがありません</div>;
  }
  const max = Math.max(...rows.map((r) => Math.max(r.income, r.outgo)), 1);

  return (
    <div className="trend">
      {rows.map((r) => {
        const d = new Date(r.month);
        return (
          <div className="trend-col" key={r.month}>
            <div className="trend-bars">
              <i className="bar-in"  style={{ height: `${(r.income / max) * 100}%` }} />
              <i className="bar-out" style={{ height: `${(r.outgo / max) * 100}%` }} />
            </div>
            <span className="trend-label num">{d.getMonth() + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
