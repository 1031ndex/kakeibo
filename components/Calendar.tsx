'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ACCOUNT, fetchRangeTx, fetchCategories, fetchBudgets, fetchMoneyAt, checkAlerts,
  generateFixed, removeTx, iso, yen, monthLabel, monthStart, monthEnd,
  cycleStart, cycleEnd, cycleKeyOf, cycleLabel,
  type Tx, type Category, type Money,
} from '@/lib/db';
import TxSheet from './TxSheet';
import Settle from './Settle';
import RefreshButton from './RefreshButton';
import BalanceSheet from './BalanceSheet';
import AlertCenter from './AlertCenter';

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

/**
 * そのカレンダーの月を開いたときに、上のカードで見せる期間。
 * 今月なら今日が入っている期間、それ以外は「その月の24日で締まる期間」。
 */
function defaultCycle(month: Date): Date {
  const today = new Date();
  if (today.getFullYear() === month.getFullYear() && today.getMonth() === month.getMonth()) {
    return cycleKeyOf(today);
  }
  return addMonths(month, -1);
}

export default function Calendar({ pending, onGoInbox, onImported }: {
  pending: number;
  onGoInbox: () => void;
  onImported: () => void;
}) {
  const [month, setMonth] = useState(() => monthStart(new Date()));
  const [cycle, setCycle] = useState(() => defaultCycle(new Date()));
  const [selected, setSelected] = useState<string | null>(null);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [money, setMoney] = useState<Money>({
    balance: 0, monthly_plan: 0, saved: 0, used: 0, savings: 0, spendable: 0,
  });
  const [variableBudget, setVariableBudget] = useState(0);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // カレンダーのマス（日曜始まり）
  const first = monthStart(month);
  const last = monthEnd(month);
  const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
  const gridEnd = new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - last.getDay()));

  const load = useCallback(async (m: Date, c: Date) => {
    setLoading(true);
    try {
      // 翌月分まで自動計上を作っておく（期間が翌月24日まで続くため）
      await generateFixed(addMonths(m, 1));
      // 通知の条件を調べる（手入力した分もすぐ反映されるように）
      await checkAlerts().catch(() => {});

      const f = monthStart(m);
      const l = monthEnd(m);
      const gs = new Date(f.getFullYear(), f.getMonth(), 1 - f.getDay());
      const ge = new Date(l.getFullYear(), l.getMonth(), l.getDate() + (6 - l.getDay()));
      // マスに出ている日と、この月にかかる2つの期間をすべて含む範囲
      const from = new Date(Math.min(gs.getTime(), cycleStart(addMonths(m, -1)).getTime()));
      const to = new Date(Math.max(ge.getTime(), cycleEnd(m).getTime()));

      const [t, cs, mo] = await Promise.all([
        fetchRangeTx(ACCOUNT.RESONA, from, to),
        fetchCategories(),
        fetchMoneyAt(cycleEnd(c)),
      ]);

      // 変動費の予算は、期間の始まりの月のもの。運用開始前の期間なら翌月のものを使う
      let b = await fetchBudgets(c);
      let vb = b.filter((x) => x.is_variable).reduce((s, x) => s + (x.amount ?? 0), 0);
      if (vb === 0) {
        b = await fetchBudgets(addMonths(c, 1));
        vb = b.filter((x) => x.is_variable).reduce((s, x) => s + (x.amount ?? 0), 0);
      }

      setTxs(t);
      setCats(cs.filter((x) => x.account_id === ACCOUNT.RESONA && !x.is_system));
      setMoney(mo);
      setVariableBudget(vb);
      setVersion((v) => v + 1);
      setError('');
    } catch (e: any) {
      setError(e.message ?? '読み込めませんでした');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(month, cycle); }, [month, cycle, load]);

  const shiftMonth = (n: number) => {
    const m = addMonths(month, n);
    setSelected(null);
    setMonth(m);
    setCycle(defaultCycle(m));
  };

  // 選んでいる期間の入出金
  const cs = iso(cycleStart(cycle));
  const ce = iso(cycleEnd(cycle));
  const inCycle = txs.filter((t) => t.occurred_on >= cs && t.occurred_on <= ce);
  const income = inCycle.filter((t) => t.type === '収入').reduce((s, t) => s + t.amount, 0);
  const outgo = inCycle.filter((t) => t.type === '支出').reduce((s, t) => s + t.amount, 0);
  const variableUsed = inCycle
    .filter((t) => t.type === '支出' && t.categories?.is_variable)
    .reduce((s, t) => s + t.amount, 0);

  // ペース: 期間の何%が過ぎて、予算の何%を使ったか
  const today = iso(new Date());
  const totalDays = Math.round((cycleEnd(cycle).getTime() - cycleStart(cycle).getTime()) / 86400000) + 1;
  const passedDays = today < cs ? 0 : today > ce ? totalDays
    : Math.round((new Date(today).getTime() - new Date(cs).getTime()) / 86400000) + 1;
  const usedRate = variableBudget ? variableUsed / variableBudget : 0;
  const timeRate = passedDays / totalDays;
  const tooFast = passedDays > 0 && passedDays < totalDays && usedRate > timeRate + 0.1;

  // 日ごとに集計
  const byDay = new Map<string, { inc: number; out: number }>();
  for (const t of txs) {
    const e = byDay.get(t.occurred_on) ?? { inc: 0, out: 0 };
    if (t.type === '収入') e.inc += t.amount; else e.out += t.amount;
    byDay.set(t.occurred_on, e);
  }

  const cells: Date[] = [];
  for (let d = new Date(gridStart); d <= gridEnd; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    cells.push(d);
  }
  const weeks: Date[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const dayTxs = selected ? txs.filter((t) => t.occurred_on === selected) : [];

  // この月にかかる2つの期間を行き来する
  const prevCycle = addMonths(month, -1);
  const nextCycle = month;
  const isPrev = cycle.getTime() === prevCycle.getTime();

  return (
    <>
      <header className="topbar">
        <h1>共通りそな</h1>
        <div className="month-nav">
          <button onClick={() => shiftMonth(-1)} aria-label="前の月">‹</button>
          <span className="month-label num">{monthLabel(month)}</span>
          <button onClick={() => shiftMonth(1)} aria-label="次の月">›</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="top-actions">
        <RefreshButton onDone={() => { load(month, cycle); onImported(); }} />
        <AlertCenter version={version} />
      </div>

      {pending > 0 && (
        <button className="notice" onClick={onGoInbox}>
          <span>未分類が {pending} 件あります</span>
          <span>振り分ける ›</span>
        </button>
      )}

      <div className="balance-card">
        <div className="cycle-switch">
          <button onClick={() => setCycle(prevCycle)} disabled={isPrev} aria-label="前の期間">‹</button>
          <span className="num">{cycleLabel(cycle)}</span>
          <button onClick={() => setCycle(nextCycle)} disabled={!isPrev} aria-label="次の期間">›</button>
        </div>

        <div className="figure-head">
          <span className="figure-label">{cycleEnd(cycle).getMonth() + 1}/24までに使えるお金</span>
          <span className="figure-value num">{yen(money.spendable)}<small>円</small></span>
        </div>
        <div className="figure-sub num">
          口座残高 {yen(money.balance)} − 貯蓄分 {yen(Math.max(0, money.savings))} 円
        </div>
        {money.savings < 0 && (
          <div className="figure-sub" style={{ color: '#FFD3CC' }}>
            年間支出が貯蓄を {yen(-money.savings)} 円上回っています
          </div>
        )}

        <div className="gauge" style={{ background: 'rgba(255,255,255,0.25)' }}>
          <i style={{
            width: `${Math.min(100, usedRate * 100)}%`,
            background: usedRate > 1 ? 'var(--shu)' : '#fff',
          }} />
        </div>
        <div className="figure-sub num" style={{ marginTop: 6 }}>
          変動費 {yen(variableUsed)} / {yen(variableBudget)} 円
          {passedDays > 0 && passedDays < totalDays && `（期間の${Math.round(timeRate * 100)}%が経過）`}
        </div>
        {tooFast && (
          <div className="figure-sub" style={{ color: '#FFD3CC', marginTop: 2 }}>
            使うペースが早めです。このままだと {yen(Math.round(variableUsed / timeRate - variableBudget))} 円オーバーします
          </div>
        )}
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
              const offCycle = key < cs || key > ce;
              const e = byDay.get(key);
              return (
                <button
                  key={key}
                  className="cal-day"
                  data-out={out}
                  data-off={offCycle}
                  data-on={selected === key}
                  data-today={key === today}
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
      <p className="figure-sub" style={{ marginTop: 6, textAlign: 'center' }}>
        {cycleLabel(cycle)} の合計（色の薄い日は期間の外）
      </p>

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
                  {t.type === '支出' && t.payer !== '共通' &&
                    (t.source === 'fixed' ? ` ・ ${t.payer}の拠出から差し引き` : ` ・ ${t.payer}が立替`)}
                  {t.is_refund && ' ・ 返金'}
                </span>
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="row-amount num" style={t.type === '収入' ? { color: 'var(--ai)' } : undefined}>
                  {t.type === '収入' ? '+' : ''}{yen(t.amount)}
                </span>
                {t.source !== 'fixed' && (
                  <button
                    onClick={async () => { await removeTx(t.id); load(month, cycle); }}
                    style={{ border: 'none', background: 'none', color: 'var(--ink-3)', padding: 4 }}
                    aria-label="削除"
                  >×</button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <Settle month={month} version={version} />

      <button className="btn btn-ghost" style={{ marginTop: 20 }} onClick={() => setAdjusting(true)}>
        通帳の残高と合わせる
      </button>

      {adding && selected && (
        <TxSheet
          title="共通りそなに手入力"
          date={selected}
          accountId={ACCOUNT.RESONA}
          cats={cats}
          showPayer
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(month, cycle); }}
        />
      )}

      {adjusting && (
        <BalanceSheet
          onClose={() => setAdjusting(false)}
          onSaved={() => { setAdjusting(false); load(month, cycle); }}
        />
      )}
    </>
  );
}
