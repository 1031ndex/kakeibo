'use client';

import { useEffect, useState } from 'react';
import {
  fetchMonthTx, fetchBudgets, fetchSavings, generateFixed,
  yen, monthLabel, type Tx, type Budget,
} from '@/lib/db';

export default function Home({ onGoInbox, pending }: { onGoInbox: () => void; pending: number }) {
  const [month, setMonth] = useState(() => new Date());
  const [txs, setTxs] = useState<Tx[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [savings, setSavings] = useState({ actual: 0, target: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        // その月の固定収支（家賃・光熱費など口座引落）を計上してから集計する
        await generateFixed(month);
        const [t, b, s] = await Promise.all([
          fetchMonthTx(month),
          fetchBudgets(month),
          fetchSavings(month.getFullYear()),
        ]);
        if (!alive) return;
        setTxs(t); setBudgets(b); setSavings(s); setError('');
      } catch (e: any) {
        if (alive) setError(e.message ?? '読み込めませんでした');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [month]);

  const shift = (n: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  // 変動費の予算と実績
  const variableBudget = budgets
    .filter((b) => b.is_variable)
    .reduce((s, b) => s + (b.monthly_amount ?? 0), 0);
  const variableActual = txs
    .filter((t) => t.is_variable && t.type === '支出')
    .reduce((s, t) => s + t.amount, 0);
  const remain = variableBudget - variableActual;

  // 支出合計（貯蓄は含めない。未分類は支出として数える）
  const spent = txs
    .filter((t) => t.type === '支出')
    .reduce((s, t) => s + t.amount, 0);

  const savingRate = savings.target > 0
    ? Math.min(100, Math.round((savings.actual / savings.target) * 100)) : 0;

  const overBudget = budgets
    .filter((b) => b.is_variable && b.monthly_amount)
    .map((b) => {
      const used = txs
        .filter((t) => t.category_id === b.category_id && t.type === '支出')
        .reduce((s, t) => s + t.amount, 0);
      return { ...b, used, over: used - (b.monthly_amount ?? 0) };
    })
    .filter((b) => b.over > 0);

  return (
    <>
      <header className="topbar">
        <h1>家計簿</h1>
        <div className="month-nav">
          <button onClick={() => shift(-1)} aria-label="前の月">‹</button>
          <span className="month-label num">{monthLabel(month)}</span>
          <button onClick={() => shift(1)} aria-label="次の月">›</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <section className="figures">
        <div className="figure">
          <div className="figure-head">
            <span className="figure-label">今月の残予算</span>
            <span className="figure-value num" data-tone={remain < 0 ? 'over' : undefined}>
              {yen(remain)}<small>円</small>
            </span>
          </div>
          <div className="figure-sub num">
            変動費 {yen(variableActual)} / {yen(variableBudget)} 円
          </div>
          <div className="gauge" data-tone={remain < 0 ? 'over' : undefined}>
            <i style={{ width: `${variableBudget ? Math.min(100, (variableActual / variableBudget) * 100) : 0}%` }} />
          </div>
        </div>

        <div className="figure">
          <div className="figure-head">
            <span className="figure-label">貯蓄の進捗</span>
            <span className="figure-value num" data-tone="save">
              {savingRate}<small>%</small>
            </span>
          </div>
          <div className="figure-sub num">
            {yen(savings.actual)} / {yen(savings.target)} 円（{month.getFullYear()}年）
          </div>
          <div className="gauge"><i style={{ width: `${savingRate}%` }} /></div>
        </div>

        <div className="figure">
          <div className="figure-head">
            <span className="figure-label">今月の支出合計</span>
            <span className="figure-value num">{yen(spent)}<small>円</small></span>
          </div>
          <div className="figure-sub">貯蓄は含みません</div>
        </div>
      </section>

      {pending > 0 && (
        <button className="btn" style={{ marginTop: 16 }} onClick={onGoInbox}>
          未分類が {pending} 件あります
        </button>
      )}

      {overBudget.length > 0 && (
        <>
          <p className="eyebrow">予算を超えています</p>
          <div className="ledger">
            {overBudget.map((b) => (
              <div key={b.category_id} className="budget-row">
                <div className="budget-head">
                  <span>{b.name}</span>
                  <span className="num" style={{ color: 'var(--shu)' }}>+{yen(b.over)} 円</span>
                </div>
                <div className="gauge" data-tone="over"><i style={{ width: '100%' }} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      <p className="eyebrow">最近の記帳</p>
      {loading ? (
        <div className="empty">読み込み中</div>
      ) : txs.length === 0 ? (
        <div className="empty">
          <strong>まだ記帳がありません</strong>
          デビットを使うと自動で入ります
        </div>
      ) : (
        <div className="ledger">
          {txs.slice(0, 8).map((t) => <Row key={t.id} tx={t} />)}
        </div>
      )}
    </>
  );
}

export function Row({ tx, onClick }: { tx: Tx; onClick?: () => void }) {
  const d = new Date(tx.occurred_at);
  const El: any = onClick ? 'button' : 'div';
  return (
    <El className="row" onClick={onClick}>
      <span className="row-date num">{d.getMonth() + 1}/{d.getDate()}</span>
      <span className="row-main">
        <span className="row-name">{tx.merchant || tx.category_name || '（名称なし）'}</span>
        <span className="row-cat">
          {tx.category_name ?? <span className="tag">未分類</span>}
          {tx.payer !== '共通' && tx.type === '支出' && tx.source !== 'fixed' && ` ・ ${tx.payer}が立替`}
          {tx.type === '収入' && ` ・ ${tx.payer}`}
          {tx.is_refund && ' ・ 返金'}
        </span>
      </span>
      <span className="row-amount num" data-minus={tx.amount < 0}>
        {yen(tx.amount)}
      </span>
    </El>
  );
}
