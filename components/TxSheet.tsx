'use client';

import { useState } from 'react';
import { addTx, type Category, type Owner, type Kind } from '@/lib/db';

export default function TxSheet({
  title, date, accountId, cats, showPayer = false, onClose, onSaved,
}: {
  title: string;
  date: string;
  accountId: number;
  cats: Category[];
  showPayer?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [on, setOn] = useState(date);
  const [catId, setCatId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState<Owner>('共通');
  const [merchant, setMerchant] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const expense = cats.filter((c) => c.kind === '支出');
  const income = cats.filter((c) => c.kind === '収入');

  async function save() {
    if (!catId || !amount) { setError('カテゴリと金額を入れてください'); return; }
    const cat = cats.find((c) => c.id === catId)!;
    setBusy(true);
    try {
      await addTx({
        occurred_on: on,
        account_id: accountId,
        type: cat.kind as Kind,
        category_id: cat.id,
        amount: Number(amount),
        payer,
        merchant,
        memo,
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
          <h2>{title}</h2>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="field">
          <label htmlFor="d">日付</label>
          <input id="d" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="c">カテゴリ</label>
          <select id="c" value={catId} onChange={(e) => setCatId(Number(e.target.value))}>
            <option value="">選んでください</option>
            {expense.length > 0 && (
              <optgroup label="支出">
                {expense.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
            {income.length > 0 && (
              <optgroup label="収入">
                {income.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
          </select>
        </div>

        <div className="field">
          <label htmlFor="a">金額</label>
          <input id="a" type="number" inputMode="numeric" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="1000" />
        </div>

        {showPayer && (
          <div className="field">
            <label htmlFor="p">支払者</label>
            <select id="p" value={payer} onChange={(e) => setPayer(e.target.value as Owner)}>
              <option value="共通">共通（りそなデビット）</option>
              <option value="りほ">りほが立替</option>
              <option value="ゆうき">ゆうきが立替</option>
            </select>
          </div>
        )}

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
