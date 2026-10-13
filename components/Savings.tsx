'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  ACCOUNT, fetchYearTx, fetchCategories, fetchBalance, fetchAnnualTargets, fetchMoneyAt, cycleEnd, cycleKeyOf,
  generateFixed, removeTx, iso, yen,
  addCategory, renameCategory, moveCategory, deactivateCategory, setAnnualTarget,
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
  const [editMode, setEditMode] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Target | 'new' | null>(null);
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

          <div className="eyebrow-row">
            <p className="eyebrow">{year}年の年間支出</p>
            <button onClick={() => setEditMode((v) => !v)}>{editMode ? '完了' : '編集'}</button>
          </div>
          <div className="ledger">
            {targets.length === 0 && <div className="empty">この年の目安が登録されていません</div>}
            {targets.map((t, i) => {
              const used = usedBy.get(t.category_id) ?? 0;
              const r = t.amount > 0 ? Math.min(100, (used / t.amount) * 100) : 0;
              const over = t.amount > 0 && used > t.amount;
              if (editMode) {
                return (
                  <div className="list-row" key={t.category_id}>
                    <button onClick={() => setEditingTarget(t)}
                      style={{ flex: 1, border: 'none', background: 'none', textAlign: 'left', padding: 0, color: 'inherit' }}>
                      <span className="name">{t.categories.name}</span><br />
                      <span className="sub">目安 {yen(t.amount)} 円 ・ タップで変更</span>
                    </button>
                    <span className="order-btns">
                      <button aria-label="上へ" disabled={i === 0} onClick={async () => {
                        await moveCategory(targets.map((x) => ({ id: x.category_id, sort_order: x.categories.sort_order })), i, -1);
                        load(year);
                      }}>▲</button>
                      <button aria-label="下へ" disabled={i === targets.length - 1} onClick={async () => {
                        await moveCategory(targets.map((x) => ({ id: x.category_id, sort_order: x.categories.sort_order })), i, 1);
                        load(year);
                      }}>▼</button>
                    </span>
                  </div>
                );
              }
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
          {editMode && (
            <button className="btn btn-ghost" style={{ marginTop: 10 }} onClick={() => setEditingTarget('new')}>
              ＋ 年間支出の項目を追加する
            </button>
          )}

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

      {editingTarget && (
        <AnnualSheet
          target={editingTarget === 'new' ? null : editingTarget}
          year={year}
          onClose={() => setEditingTarget(null)}
          onSaved={() => { setEditingTarget(null); load(year); }}
        />
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

function AnnualSheet({ target, year, onClose, onSaved }: {
  target: Target | null; year: number; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(target?.categories.name ?? '');
  const [amount, setAmount] = useState(target ? String(target.amount) : '');
  const [later, setLater] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  async function save() {
    if (!name.trim()) { setError('名前を入れてください'); return; }
    const amt = Number(amount || 0);
    if (!(amt >= 0)) { setError('金額を入れてください'); return; }
    setBusy(true);
    try {
      if (target) {
        if (name.trim() !== target.categories.name) await renameCategory(target.category_id, name);
        if (amt !== target.amount) {
          await setAnnualTarget(target.category_id, year, amt, later);
        }
      } else {
        const id = await addCategory(name, 'annual');
        await setAnnualTarget(id, year, amt, true);
      }
      onSaved();
    } catch (e: any) {
      setError(e.message ?? '保存できませんでした');
      setBusy(false);
    }
  }

  async function off() {
    if (!target) return;
    setBusy(true);
    try {
      await deactivateCategory(target.category_id);
      onSaved();
    } catch (e: any) {
      setError(e.message ?? 'やめられませんでした');
      setBusy(false);
    }
  }

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet-body" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{target ? '年間支出の変更' : '年間支出の追加'}</h2>
          <button onClick={onClose}>閉じる</button>
        </div>

        <div className="field">
          <label htmlFor="an">名前</label>
          <input id="an" value={name} placeholder="例：車検" onChange={(e) => setName(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="aa">{year}年の目安額</label>
          <input id="aa" type="number" inputMode="numeric" value={amount} placeholder="0"
            onChange={(e) => setAmount(e.target.value)} />
        </div>

        {target && (
          <label className="switch" style={{ marginTop: 12 }}>
            <span>
              <span className="name">{year + 1}年以降も同じ額にする</span><br />
              <span className="sub">オフにすると{year}年だけ変わり、翌年以降に入っている額はそのまま</span>
            </span>
            <input type="checkbox" checked={later} onChange={(e) => setLater(e.target.checked)} />
          </label>
        )}

        <p className="figure-sub" style={{ marginTop: 8 }}>
          目安は予算ではなく参考の額です。超えても貯蓄から出るだけで、生活費には影響しません。
          {!target && ' 翌年以降も、変えるまでは同じ額が出ます。'}
        </p>

        {error && <p className="error">{error}</p>}

        <div style={{ marginTop: 18 }}>
          <button className="btn" onClick={save} disabled={busy}>
            {busy ? '保存中' : target ? '変更する' : '追加する'}
          </button>
        </div>

        {target && (
          <div style={{ marginTop: 10 }}>
            {!confirmOff ? (
              <button className="btn btn-ghost" style={{ color: 'var(--shu)' }} onClick={() => setConfirmOff(true)}>
                この項目をやめる
              </button>
            ) : (
              <>
                <p className="figure-sub">
                  一覧と入力の候補から外します。これまでの支出の記録は残り、貯蓄の計算にもそのまま入ります。
                  設定 → カテゴリ の「やめたカテゴリ」から戻せます。
                </p>
                <button className="btn" style={{ marginTop: 8, background: 'var(--shu)' }} onClick={off} disabled={busy}>
                  やめる
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
