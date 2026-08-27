'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  fetchBudgets, changeBudget, fetchFixedEntries, changeFixedAmount,
  fetchRules, removeRule, monthLabel, yen, type Budget,
} from '@/lib/db';

export default function Settings() {
  const [tab, setTab] = useState<'budget' | 'fixed' | 'rules'>('budget');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [fixed, setFixed] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [b, f, r] = await Promise.all([fetchBudgets(new Date()), fetchFixedEntries(), fetchRules()]);
      setBudgets(b); setFixed(f); setRules(r); setError('');
    } catch (e: any) {
      setError(e.message ?? '読み込めませんでした');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <header className="topbar"><h1>設定</h1></header>

      {error && <p className="error">{error}</p>}

      <div className="seg">
        <button data-on={tab === 'budget'} onClick={() => setTab('budget')}>予算</button>
        <button data-on={tab === 'fixed'} onClick={() => setTab('fixed')}>固定収支</button>
        <button data-on={tab === 'rules'} onClick={() => setTab('rules')}>店名ルール</button>
      </div>

      {tab === 'budget' && (
        <>
          <p className="eyebrow">タップすると金額を変えられます</p>
          <div className="ledger">
            {budgets.filter((b) => b.amount !== null).map((b) => (
              <button className="list-row" key={b.category_id}
                style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }}
                onClick={() => setEditing(b)}>
                <span>
                  <span className="name">{b.name}</span><br />
                  <span className="sub">
                    {b.account_kind === 'resona' ? '共通りそな' : b.account_kind === 'savings' ? '貯蓄口座' : '運用資産'}
                    {b.is_variable && ' ・ 変動費'}
                  </span>
                </span>
                <span className="row-amount num">{yen(b.amount ?? 0)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {tab === 'fixed' && (
        <>
          <p className="eyebrow">毎月このタイミングで自動計上されます</p>
          <div className="ledger">
            {fixed.map((f) => (
              <div className="list-row" key={f.id}>
                <span>
                  <span className="name">{f.name}</span><br />
                  <span className="sub">毎月{f.day_of_month}日 ・ {f.kind} ・ {f.payer}</span>
                </span>
                <span className="row-amount num">{yen(f.amount)}</span>
              </div>
            ))}
          </div>
          <p className="figure-sub" style={{ marginTop: 10 }}>
            金額を変えるときは「予算」タブから変更してください。過去の記帳を残したまま切り替わります。
          </p>
        </>
      )}

      {tab === 'rules' && (
        <>
          <p className="eyebrow">店名からカテゴリを自動判定するルール</p>
          <div className="ledger">
            {rules.length === 0 && <div className="empty">ルールはまだありません</div>}
            {rules.map((r) => (
              <div className="list-row" key={r.id}>
                <span>
                  <span className="name">{r.pattern}</span><br />
                  <span className="sub">→ {r.categories?.name}</span>
                </span>
                <button onClick={async () => { await removeRule(r.id); load(); }}
                  style={{ border: 'none', background: 'none', color: 'var(--shu)', padding: 4 }}>
                  削除
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: 28 }}>
        <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>
          ログアウト
        </button>
      </div>

      {editing && (
        <BudgetSheet
          budget={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function BudgetSheet({ budget, onClose, onSaved }: {
  budget: Budget; onClose: () => void; onSaved: () => void;
}) {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const [amount, setAmount] = useState(String(budget.amount ?? 0));
  const [from, setFrom] = useState(`${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}`);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const [y, m] = from.split('-').map(Number);
      await changeBudget(budget.category_id, Number(amount), new Date(y, m - 1, 1));
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
          <h2>{budget.name}</h2>
          <button onClick={onClose}>閉じる</button>
        </div>

        <p className="figure-sub" style={{ marginTop: 8 }}>
          今の金額は {yen(budget.amount ?? 0)} 円です。変更しても過去の記帳はそのまま残ります。
        </p>

        <div className="field">
          <label htmlFor="ba">新しい金額</label>
          <input id="ba" type="number" inputMode="numeric" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="bf">いつから適用するか</label>
          <input id="bf" type="month" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>

        {error && <p className="error">{error}</p>}

        <div style={{ marginTop: 18 }}>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? '保存中' : '変更する'}
          </button>
        </div>
      </div>
    </div>
  );
}
