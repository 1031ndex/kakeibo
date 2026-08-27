'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ACCOUNT, fetchYearTx, fetchCategories, fetchBalance, fetchAnnualTargets,
  generateFixed, removeTx, iso, yen, type Tx, type Category,
} from '@/lib/db';
import TxSheet from './TxSheet';

export default function Savings() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [tab, setTab] = useState<'cash' | 'invest'>('cash');
  const [txs, setTxs] = useState<Tx[]>([]);
  const [investTxs, setInvestTxs] = useState<Tx[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [balance, setBalance] = useState(0);
  const [investTotal, setInvestTotal] = useState(0);
  const [targets, setTargets] = useState<{ category_id: number; amount: number; categories: { name: string } }[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (y: number) => {
    try {
      // 今月分の積立が未計上なら計上しておく
      await generateFixed(new Date());
      const [t, it, c, bal, inv, tg] = await Promise.all([
        fetchYearTx(ACCOUNT.SAVINGS, y),
        fetchYearTx(ACCOUNT.INVEST, y),
        fetchCategories(),
        fetchBalance(ACCOUNT.SAVINGS),
        fetchBalance(ACCOUNT.INVEST),
        fetchAnnualTargets(y),
      ]);
      setTxs(t); setInvestTxs(it); setCats(c);
      setBalance(bal); setInvestTotal(inv); setTargets(tg);
      setError('');
    } catch (e: any) {
      setError(e.message ?? '読み込めませんでした');
    }
  }, []);

  useEffect(() => { load(year); }, [year, load]);

  const income = txs.filter((t) => t.type === '収入').reduce((s, t) => s + t.amount, 0);
  const outgo = txs.filter((t) => t.type === '支出').reduce((s, t) => s + t.amount, 0);

  // 年間支出の項目ごとの使用額
  const usedBy = new Map<number, number>();
  for (const t of txs) {
    if (t.type === '支出' && t.category_id) {
      usedBy.set(t.category_id, (usedBy.get(t.category_id) ?? 0) + t.amount);
    }
  }

  // 運用資産の項目ごとの累計
  const investBy = new Map<string, number>();
  for (const t of investTxs) {
    const n = t.categories?.name ?? '';
    investBy.set(n, (investBy.get(n) ?? 0) + t.amount);
  }

  return (
    <>
      <header className="topbar">
        <h1>貯蓄</h1>
        <div className="month-nav">
          <button onClick={() => setYear((y) => y - 1)} aria-label="前の年">‹</button>
          <span className="month-label num">{year}年</span>
          <button onClick={() => setYear((y) => y + 1)} aria-label="次の年">›</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="seg">
        <button data-on={tab === 'cash'} onClick={() => setTab('cash')}>貯蓄口座</button>
        <button data-on={tab === 'invest'} onClick={() => setTab('invest')}>運用資産</button>
      </div>

      {tab === 'cash' ? (
        <>
          <div className="balance-card">
            <div className="figure-head">
              <span className="figure-label">貯蓄口座の残高</span>
              <span className="figure-value num">{yen(balance)}<small>円</small></span>
            </div>
            <div className="figure-sub num">
              {year}年　入金 {yen(income)} − 使用 {yen(outgo)} 円
            </div>
          </div>

          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
            ボーナス・年間支出を入力
          </button>

          <p className="eyebrow">年間支出の使用状況</p>
          <div className="ledger">
            {targets.length === 0 && <div className="empty">この年の目安が登録されていません</div>}
            {targets.map((t) => {
              const used = usedBy.get(t.category_id) ?? 0;
              const rate = t.amount > 0 ? Math.min(100, (used / t.amount) * 100) : 0;
              const over = t.amount > 0 && used > t.amount;
              return (
                <div className="budget-row" key={t.category_id}>
                  <div className="budget-head">
                    <span>{t.categories.name}</span>
                    <span className="num" style={over ? { color: 'var(--shu)' } : undefined}>
                      {yen(used)} / {yen(t.amount)}
                    </span>
                  </div>
                  <div className="gauge" data-tone={over ? 'over' : undefined}>
                    <i style={{ width: `${rate}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="eyebrow">入出金の記録</p>
          {txs.length === 0 ? (
            <div className="empty">
              <strong>まだ記録がありません</strong>
              毎月25日に積立が自動で入ります
            </div>
          ) : (
            <div className="ledger">
              {txs.map((t) => (
                <div className="list-row" key={t.id}>
                  <span>
                    <span className="name">{t.merchant || t.categories?.name}</span>
                    <br />
                    <span className="sub">{t.occurred_on.replace(/-/g, '/')}　{t.categories?.name}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="row-amount num" style={t.type === '収入' ? { color: 'var(--ai)' } : { color: 'var(--shu)' }}>
                      {t.type === '収入' ? '+' : '−'}{yen(t.amount)}
                    </span>
                    {t.source !== 'fixed' && (
                      <button onClick={async () => { await removeTx(t.id); load(year); }}
                        style={{ border: 'none', background: 'none', color: 'var(--ink-3)', padding: 4 }}
                        aria-label="削除">×</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="balance-card">
            <div className="figure-head">
              <span className="figure-label">運用資産の積立累計</span>
              <span className="figure-value num">{yen(investTotal)}<small>円</small></span>
            </div>
            <div className="figure-sub">
              給与口座から自動で引かれる分。現金ではないため貯蓄口座とは分けています
            </div>
          </div>

          <p className="eyebrow">{year}年の積立</p>
          <div className="ledger">
            {investBy.size === 0 ? (
              <div className="empty">この年の記録はありません</div>
            ) : (
              Array.from(investBy.entries()).map(([name, total]) => (
                <div className="list-row" key={name}>
                  <span className="name">{name}</span>
                  <span className="row-amount num">{yen(total)}</span>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {adding && (
        <TxSheet
          title="貯蓄口座に手入力"
          date={iso(new Date())}
          accountId={ACCOUNT.SAVINGS}
          cats={cats.filter((c) => c.account_id === ACCOUNT.SAVINGS)}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(year); }}
        />
      )}
    </>
  );
}
