'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  fetchMonthTx, fetchCategories, addManual, removeTx,
  yen, monthLabel, iso, type Tx, type Category, type Owner,
} from '@/lib/db';
import { Row } from './Home';

export default function Ledger() {
  const [month, setMonth] = useState(() => new Date());
  const [txs, setTxs] = useState<Tx[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Tx | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([fetchMonthTx(month), fetchCategories()]);
      setTxs(t); setCats(c); setError('');
    } catch (e: any) {
      setError(e.message ?? '読み込めませんでした');
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const shift = (n: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));

  const total = txs
    .filter((t) => t.type === '支出' && t.category_kind !== '貯蓄')
    .reduce((s, t) => s + t.amount, 0);

  return (
    <>
      <header className="topbar">
        <h1>明細</h1>
        <div className="month-nav">
          <button onClick={() => shift(-1)} aria-label="前の月">‹</button>
          <span className="month-label num">{monthLabel(month)}</span>
          <button onClick={() => shift(1)} aria-label="次の月">›</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      <div className="figures">
        <div className="figure">
          <div className="figure-head">
            <span className="figure-label">支出合計</span>
            <span className="figure-value num">{yen(total)}<small>円</small></span>
          </div>
          <div className="figure-sub num">{txs.length} 件の記帳</div>
        </div>
      </div>

      <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
        手入力で追加
      </button>

      <p className="eyebrow">記帳</p>
      {txs.length === 0 ? (
        <div className="empty">
          <strong>この月の記帳はありません</strong>
          手入力で追加できます
        </div>
      ) : (
        <div className="ledger">
          {txs.map((t) => <Row key={t.id} tx={t} onClick={() => setSelected(t)} />)}
        </div>
      )}

      {adding && (
        <AddSheet
          cats={cats}
          month={month}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load(); }}
        />
      )}

      {selected && (
        <DetailSheet
          tx={selected}
          onClose={() => setSelected(null)}
          onDeleted={() => { setSelected(null); load(); }}
        />
      )}
    </>
  );
}

function AddSheet({ cats, month, onClose, onSaved }: {
  cats: Category[]; month: Date; onClose: () => void; onSaved: () => void;
}) {
  const today = new Date();
  const defaultDate = month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear()
    ? iso(today) : iso(new Date(month.getFullYear(), month.getMonth(), 1));

  const [date, setDate] = useState(defaultDate);
  const [catId, setCatId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState<Owner>('共通');
  const [merchant, setMerchant] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!catId || !amount) { setError('カテゴリと金額を入力してください'); return; }
    const cat = cats.find((c) => c.id === catId)!;
    setBusy(true);
    try {
      await addManual({
        occurred_at: new Date(`${date}T12:00:00+09:00`).toISOString(),
        category_id: cat.id,
        amount: Number(amount),
        payer,
        merchant,
        memo,
        type: cat.kind,
        pocket_id: cat.pocket_id,
      });
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
          <h2>手入力で追加</h2>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="field">
          <label htmlFor="d">日付</label>
          <input id="d" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="c">カテゴリ</label>
          <select id="c" value={catId} onChange={(e) => setCatId(Number(e.target.value))}>
            <option value="">選んでください</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="a">金額</label>
          <input id="a" type="number" inputMode="numeric" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="1000" />
        </div>
        <div className="field">
          <label htmlFor="p">支払者</label>
          <select id="p" value={payer} onChange={(e) => setPayer(e.target.value as Owner)}>
            <option value="共通">共通（りそなデビット）</option>
            <option value="りほ">りほが立替</option>
            <option value="ゆうき">ゆうきが立替</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="m">店名・内容</label>
          <input id="m" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mm">メモ</label>
          <input id="mm" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>

        {error && <p className="error">{error}</p>}

        <div style={{ marginTop: 18 }}>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? '保存中' : '保存する'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DetailSheet({ tx, onClose, onDeleted }: {
  tx: Tx; onClose: () => void; onDeleted: () => void;
}) {
  const [error, setError] = useState('');
  const d = new Date(tx.occurred_at);
  const sourceLabel = { auto: 'デビット自動取込', manual: '手入力', fixed: '固定収支から計上' }[tx.source];

  async function del() {
    try { await removeTx(tx.id); onDeleted(); }
    catch (e: any) { setError(e.message ?? '削除できませんでした'); }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>記帳の詳細</h2>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="slip">
          <div className="slip-store">{tx.merchant || tx.category_name}</div>
          <div className="slip-meta num">
            {d.getFullYear()}/{d.getMonth() + 1}/{d.getDate()}　{tx.category_name ?? '未分類'}
          </div>
          <div className="slip-amount num">{yen(tx.amount)} 円</div>
          <div className="slip-meta">
            支払者 {tx.payer}　・　{sourceLabel}
            {tx.memo && <><br />{tx.memo}</>}
          </div>
        </div>

        {error && <p className="error">{error}</p>}

        <div style={{ marginTop: 18 }}>
          <button className="btn btn-ghost" style={{ color: 'var(--shu)' }} onClick={del}>
            この記帳を削除する
          </button>
        </div>
      </div>
    </div>
  );
}
