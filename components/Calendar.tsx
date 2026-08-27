'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ACCOUNT, fetchMonthTx, fetchCategories, fetchBudgets, fetchCarryover,
  generateFixed, addTx, removeTx, iso, yen, monthLabel, monthStart, monthEnd,
  type Tx, type Category,
} from '@/lib/db';
import TxSheet from './TxSheet';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

export default function Calendar() {
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [carryover, setCarryover] = useState(0);
  const [variableBudget, setVariableBudget] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (target: Date) => {
    setLoading(true);
    try {
      await generateFixed(target);
      const [t, c, co, b] = await Promise.all([
        fetchMonthTx(ACCOUNT.RESONA, target),
        fetchCategories(),
        fetchCarryover(ACCOUNT.RESONA, target),
        fetchBudgets(target),
      ]);
      setTxs(t);
      setCats(c.filter((x) => x.account_id === ACCOUNT.RESONA));
      setCarryover(co);
      setVariableBudget(
        b.filter((x) => x.is_variable).reduce((s, x) => s + (x.amount ?? 0), 0)
      );
      setError('');
    } catch (e: any) {
      setError(e.message ?? '読み込めませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(month); }, [month, load]);

  const shift = (n: number) => {
    setSelected(null);
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  };

  const income = txs.filter((t) => t.type === '収入').reduce((s, t) => s + t.amount, 0);
  const outgo = txs.filter((t) => t.type === '支出').reduce((s, t) => s + t.amount, 0);
  const balance = carryover + income - outgo;

  const variableUsed = txs
    .filter((t) => t.type === '支出' && t.categories?.is_variable)
    .reduce((s, t) => s + t.amount, 0);

  // 日ごとに集計
  const byDay = new Map<string, { inc: number; out: number }>();
  for (const t of txs) {
    const e = byDay.get(t.occurred_on) ?? { inc: 0, out: 0 };
    if (t.type === '収入') e.inc += t.amount; else e.out += t.amount;
    byDay.set(t.occurred_on, e);
  }

  // カレンダーのマス（日曜始まり）
  const first = monthStart(month);
  const last = monthEnd(month);
  const cells: Date[] = [];
  for (let i = first.getDay(); i > 0; i--) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), 1 - i));
  }
  for (let d = 1; d <= last.getDate(); d++) {
    cells.push(new Date(first.getFullYear(), first.getMonth(), d));
  }
  while (cells.length % 7 !== 0) {
    const lastCell = cells[cells.length - 1];
    cells.push(new Date(lastCell.getFullYear(), lastCell.getMonth(), lastCell.getDate() + 1));
  }
  const weeks: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const todayIso = iso(new Date());
  const dayTxs = selected ? txs.filter((t) => t.occurred_on === selected) : [];

  return (
    <>
      <header className="topbar">
        <h1>共通りそな</h1>
        <div className="month-nav">
          <button onClick={() => shift(-1)} aria-label="前の月">‹</button>
          <span className="month-label num">{monthLabel(month)}</span>
          <button onClick={() => shift(1)} aria-label="次の月">›</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="balance-card">
        <div className="figure-head">
          <span className="figure-label">月末の残り</span>
          <span className="figure-value num">{yen(balance)}<small>円</small></span>
        </div>
        <div className="figure-sub num">
          繰越 {yen(carryover)} ＋ 入金 {yen(income)} − 支払 {yen(outgo)} 円
        </div>
        <div className="gauge" style={{ background: 'rgba(255,255,255,0.25)' }}>
          <i style={{
            width: `${variableBudget ? Math.min(100, (variableUsed / variableBudget) * 100) : 0}%`,
            background: variableUsed > variableBudget ? 'var(--shu)' : '#fff',
          }} />
        </div>
        <div className="figure-sub num" style={{ marginTop: 6 }}>
          変動費 {yen(variableUsed)} / {yen(variableBudget)} 円
        </div>
      </div>

      <div className="cal">
        <div className="cal-week cal-head">
          {WEEK.map((w, i) => (
            <span key={w} data-sun={i === 0} data-sat={i === 6}>{w}</span>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div className="cal-week" key={wi}>
            {week.map((d) => {
              const key = iso(d);
              const out = d.getMonth() !== month.getMonth();
              const e = byDay.get(key);
              return (
                <button
                  key={key}
                  className="cal-day"
                  data-out={out}
                  data-on={selected === key}
                  data-today={key === todayIso}
                  onClick={() => setSelected(selected === key ? null : key)}
                >
                  <span className="cal-num">{d.getDate()}</span>
                  {e?.out ? <span className="cal-out">{yen(e.out)}</span> : null}
                  {e?.inc ? <span className="cal-in">{yen(e.inc)}</span> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <dl className="totals">
        <div><dt>入金</dt><dd data-tone="in" >{yen(income)}</dd></div>
        <div><dt>支払</dt><dd data-tone="out">{yen(outgo)}</dd></div>
        <div><dt>差引</dt><dd>{yen(income - outgo)}</dd></div>
      </dl>

      <div className="daybar">
        <h2>{selected ? selected.replace(/-/g, '/') : '日付を選ぶと明細が出ます'}</h2>
        {selected && <button onClick={() => setAdding(true)}>手入力</button>}
      </div>

      {loading ? (
        <div className="empty">読み込み中</div>
      ) : !selected ? (
        <div className="empty">
          <strong>カレンダーから日付を選んでください</strong>
          その日の明細を見たり、手入力で追加できます
        </div>
      ) : dayTxs.length === 0 ? (
        <div className="empty">
          <strong>この日の記帳はありません</strong>
          手入力から追加できます
        </div>
      ) : (
        <div className="ledger">
          {dayTxs.map((t) => (
            <div className="list-row" key={t.id}>
              <span>
                <span className="name">{t.merchant || t.categories?.name}</span>
                <br />
                <span className="sub">
                  {t.categories?.name ?? <span className="tag">未分類</span>}
                  {t.payer !== '共通' && ` ・ ${t.payer}が立替`}
                  {t.is_refund && ' ・ 返金'}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="row-amount num" style={t.type === '収入' ? { color: 'var(--ai)' } : undefined}>
                  {t.type === '収入' ? '+' : ''}{yen(t.amount)}
                </span>
                {t.source !== 'fixed' && (
                  <button
                    onClick={async () => { await removeTx(t.id); load(month); }}
                    style={{ border: 'none', background: 'none', color: 'var(--ink-3)', padding: 4 }}
                    aria-label="削除"
                  >×</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {adding && selected && (
        <TxSheet
          title="共通りそなに手入力"
          date={selected}
          accountId={ACCOUNT.RESONA}
          cats={cats}
          showPayer
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(month); }}
        />
      )}
    </>
  );
}
