'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ACCOUNT, fetchYearTx, fetchCategories, fetchBalance, fetchAnnualTargets, fetchMoneyAt, cycleEnd, cycleKeyOf,
  generateFixed, removeTx, iso, yen,
  type Tx, type Category, type Money,
} from '@/lib/db';
import TxSheet from './TxSheet';

type Target = Awaited<ReturnType<typeof fetchAnnualTargets>>[number];

export default function Savings() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [tab, setTab] = useState<'cash' | 'invest'>('cash');
  const [txs, setTxs] = useState<Tx[]>([]);
  const [investTxs, setInvestTxs] = useState<Tx[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [money, setMoney] = useState<Money>({
    balance: 0, monthly_plan: 0, saved: 0, used: 0, savings: 0, spendable: 0,
  });
  const [investTotal, setInvestTotal] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (y: number) => {
    try {
      // 過去の年はその年末時点、今年以降は今の期間の締め（24日）時点の貯蓄を出す
      const now = new Date();
      const asOf = y < now.getFullYear() ? new Date(y, 11, 31) : cycleEnd(cycleKeyOf(now));
      await generateFixed(now);
      const [t, it, c, m, inv, tg] = await Promise.all([
        fetchYearTx(ACCOUNT.RESONA, y),
        fetchYearTx(ACCOUNT.INVEST, y),
        fetchCategories(),
        fetchMoneyAt(asOf),
        fetchBalance(ACCOUNT.INVEST),
        fetchAnnualTargets(y),
      ]);
      setTxs(t); setInvestTxs(it); setCats(c);
      setMoney(m); setInvestTotal(inv); setTargets(tg);
      setError('');
    } catch (e: any) {
      setError(e.message ?? '読み込めませんでした');
    }
  }, []);

  useEffect(() => { load(year); }, [year, load]);

  // 貯蓄に関わる記帳だけを抜き出す（年間支出・ボーナス・還付金）
  const savingsTxs = txs.filter(
    (t) => (t.type === '支出' && t.categories?.is_annual)
        || (t.type === '収入' && t.categories?.is_savings_income)
  );

  const usedBy = new Map<number, number>();
  for (const t of savingsTxs) {
    if (t.type === '支出' && t.category_id) {
      usedBy.set(t.category_id, (usedBy.get(t.category_id) ?? 0) + t.amount);
    }
  }

  const investBy = new Map<string, number>();
  for (const t of investTxs) {
    const n = t.categories?.name ?? '';
    investBy.set(n, (investBy.get(n) ?? 0) + t.amount);
  }

  const rate = money.saved > 0 ? Math.min(100, (money.used / money.saved) * 100) : 0;

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
        <button data-on={tab === 'cash'} onClick={() => setTab('cash')}>貯蓄</button>
        <button data-on={tab === 'invest'} onClick={() => setTab('invest')}>運用資産</button>
      </div>

      {tab === 'cash' ? (
        <>
          <div className="balance-card">
            <div className="figure-head">
              <span className="figure-label">
                貯蓄の残り{year < thisYear ? `（${year}年末）` : ''}
              </span>
              <span className="figure-value num">{yen(money.savings)}<small>円</small></span>
            </div>
            <div className="figure-sub num">
              これまでの積立 {yen(money.saved)} − 年間支出 {yen(money.used)} 円
            </div>
            <div className="gauge" style={{ background: 'rgba(255,255,255,0.25)' }}>
              <i style={{ width: `${rate}%`, background: '#fff' }} />
            </div>
            <div className="figure-sub num" style={{ marginTop: 6 }}>
              毎月の積立 {yen(money.monthly_plan)} 円（拠出 − 生活費の予算）
            </div>
          </div>

          <p className="figure-sub" style={{ marginTop: 10 }}>
            共通りそなの残高のうち、生活費として使わない分です。
            ボーナス・還付金はここに入り、旅行・住民税・誕生日などはここから出ます。
          </p>

          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
            ボーナス・年間支出を記録する
          </button>

          <p className="eyebrow">{year}年の年間支出</p>
          <div className="ledger">
            {targets.length === 0 && <div className="empty">この年の目安が登録されていません</div>}
            {targets.map((t) => {
              const used = usedBy.get(t.category_id) ?? 0;
              const r = t.amount > 0 ? Math.min(100, (used / t.amount) * 100) : 0;
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
                    <i style={{ width: `${r}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="eyebrow">{year}年の記録</p>
          {savingsTxs.length === 0 ? (
            <div className="empty">
              <strong>まだ記録がありません</strong>
              ボーナスや旅行代を記録するとここに並びます
            </div>
          ) : (
            <div className="ledger">
              {savingsTxs.map((t) => (
                <div className="list-row" key={t.id}>
                  <span>
                    <span className="name">{t.merchant || t.categories?.name}</span><br />
                    <span className="sub">{t.occurred_on.replace(/-/g, '/')}　{t.categories?.name}</span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="row-amount num"
                      style={{ color: t.type === '収入' ? 'var(--ai)' : 'var(--shu)' }}>
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
              給与口座から自動で引かれる分（個人年金・自社株・投資信託・NISA）。
              現金ではないため貯蓄とは分けています
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
          title="ボーナス・年間支出を記録"
          date={iso(new Date())}
          accountId={ACCOUNT.RESONA}
          cats={cats.filter((c) => c.is_annual || c.is_savings_income)}
          showPayer
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(year); }}
        />
      )}
    </>
  );
}
