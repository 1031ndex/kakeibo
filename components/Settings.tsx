'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  fetchBudgets, changeBudget, fetchFixedEntries, updateFixed, regenerateMonth,
  fetchRules, removeRule, fetchSettings, setSetting, yen, type Budget,
} from '@/lib/db';

export default function Settings() {
  const [tab, setTab] = useState<'budget' | 'fixed' | 'rules' | 'import'>('budget');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [fixed, setFixed] = useState<any[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [editingFixed, setEditingFixed] = useState<any | null>(null);
  const [conf, setConf] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [b, f, r, c] = await Promise.all([
        fetchBudgets(new Date()), fetchFixedEntries(), fetchRules(), fetchSettings(),
      ]);
      setBudgets(b); setFixed(f); setRules(r); setConf(c); setError('');
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
        <button data-on={tab === 'import'} onClick={() => setTab('import')}>取込</button>
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
              <button className="list-row" key={f.id}
                style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }}
                onClick={() => setEditingFixed(f)}>
                <span>
                  <span className="name">{f.name}</span><br />
                  <span className="sub">
                    毎月{f.day_of_month >= 31 ? '末日' : `${f.day_of_month}日`} ・ {f.kind} ・ {f.payer}
                  </span>
                </span>
                <span className="row-amount num">{yen(f.amount)}</span>
              </button>
            ))}
          </div>
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

      {tab === 'import' && (
        <>
          <p className="eyebrow">りそなデビットのメール取込</p>
          <div className="ledger">
            <label className="switch">
              <span>
                <span className="name">取込を有効にする</span><br />
                <span className="sub">オフにすると新しい明細が入らなくなります</span>
              </span>
              <input
                type="checkbox"
                checked={conf.import_enabled === 'true'}
                onChange={async (e) => {
                  await setSetting('import_enabled', e.target.checked ? 'true' : 'false');
                  load();
                }}
              />
            </label>
            <label className="switch">
              <span>
                <span className="name">この日以降のメールを取り込む</span><br />
                <span className="sub">これより前のメールは無視されます</span>
              </span>
              <input
                type="date"
                value={conf.import_from ?? ''}
                onChange={async (e) => {
                  await setSetting('import_from', e.target.value);
                  load();
                }}
              />
            </label>
          </div>
          <p className="figure-sub" style={{ marginTop: 10 }}>
            設定はすぐ反映されます。取込は1時間ごとに動きます。
          </p>
        </>
      )}

      <div style={{ marginTop: 28 }}>
        <button className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>
          ログアウト
        </button>
      </div>

      {editingFixed && (
        <FixedSheet
          entry={editingFixed}
          onClose={() => setEditingFixed(null)}
          onSaved={() => { setEditingFixed(null); load(); }}
        />
      )}

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

function FixedSheet({ entry, onClose, onSaved }: {
  entry: any; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(entry.name);
  const [amount, setAmount] = useState(String(entry.amount));
  const [day, setDay] = useState(String(entry.day_of_month));
  const [redo, setRedo] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await updateFixed(entry.id, {
        name,
        amount: Number(amount),
        day_of_month: Number(day),
      });
      if (redo) await regenerateMonth(entry.id, new Date());
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
          <h2>固定収支の変更</h2>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="field">
          <label htmlFor="fn">名前</label>
          <input id="fn" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="fa">金額</label>
          <input id="fa" type="number" inputMode="numeric" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="fd">計上日</label>
          <select id="fd" value={day} onChange={(e) => setDay(e.target.value)}>
            {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}日</option>
            ))}
            <option value="31">末日</option>
          </select>
        </div>

        <label className="learn">
          <input type="checkbox" checked={redo} onChange={(e) => setRedo(e.target.checked)} />
          今月の記帳も作り直す
        </label>

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
