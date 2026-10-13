'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  fetchBudgets, changeBudget, fetchFixedEntries, changeFixed,
  fetchRules, removeRule, fetchSettings, setSetting, yen,
  type Budget, type FixedEntry,
} from '@/lib/db';

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const fromYm = (s: string) => { const [y, m] = s.split('-').map(Number); return new Date(y, m - 1, 1); };
const monthJa = (iso: string) => `${Number(iso.slice(5, 7))}月`;

const accountLabel = (b: Budget) =>
  b.account_kind === 'invest' ? '運用資産' : b.is_contribution ? '拠出' : '共通りそな';

export default function Settings() {
  const [tab, setTab] = useState<'budget' | 'fixed' | 'rules' | 'import' | 'alert'>('budget');
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [fixed, setFixed] = useState<FixedEntry[]>([]);
  const [rules, setRules] = useState<any[]>([]);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [editingFixed, setEditingFixed] = useState<FixedEntry | null>(null);
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

  // 今月の貯蓄額の内訳（拠出の合計 − 生活費の予算）
  const resona = budgets.filter((b) => b.account_kind === 'resona');
  const contrib = resona.filter((b) => b.is_contribution).reduce((s, b) => s + (b.amount ?? 0), 0);
  const living = resona
    .filter((b) => b.kind === '支出' && !b.is_annual)
    .reduce((s, b) => s + (b.amount ?? 0), 0);

  const shown = budgets.filter((b) => b.amount !== null || b.next_amount !== null);

  return (
    <>
      <header className="topbar"><h1>設定</h1></header>

      {error && <p className="error">{error}</p>}

      <div className="seg">
        <button data-on={tab === 'budget'} onClick={() => setTab('budget')}>予算</button>
        <button data-on={tab === 'fixed'} onClick={() => setTab('fixed')}>自動計上</button>
        <button data-on={tab === 'rules'} onClick={() => setTab('rules')}>店名ルール</button>
        <button data-on={tab === 'import'} onClick={() => setTab('import')}>取込</button>
        <button data-on={tab === 'alert'} onClick={() => setTab('alert')}>通知</button>
      </div>

      {tab === 'budget' && (
        <>
          <div className="settle">
            <div className="settle-name">今月の貯蓄額</div>
            <div className="settle-pay">{yen(contrib - living)} 円</div>
            <div className="settle-calc">
              拠出 {yen(contrib)} − 生活費の予算 {yen(living)}
            </div>
          </div>
          <p className="figure-sub" style={{ marginTop: 8 }}>
            拠出や生活費の予算を変えると、その月から貯蓄額も自動で変わります。
          </p>

          <p className="eyebrow">タップすると金額を変えられます</p>
          <div className="ledger">
            {shown.map((b) => (
              <button className="list-row" key={b.category_id}
                style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }}
                onClick={() => setEditing(b)}>
                <span>
                  <span className="name">{b.name}</span><br />
                  <span className="sub">
                    {accountLabel(b)}
                    {b.is_variable && ' ・ 変動費'}
                    {b.next_from && ` ・ ${monthJa(b.next_from)}から ${yen(b.next_amount ?? 0)}`}
                  </span>
                </span>
                <span className="row-amount num">
                  {b.amount === null ? '—' : yen(b.amount)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {tab === 'fixed' && (
        <>
          <p className="eyebrow">毎月このタイミングで自動で記帳されます</p>
          <div className="ledger">
            {fixed.map((f) => (
              <button className="list-row" key={f.id}
                style={{ width: '100%', border: 'none', background: 'none', textAlign: 'left' }}
                onClick={() => setEditingFixed(f)}>
                <span>
                  <span className="name">{f.name}</span><br />
                  <span className="sub">
                    {f.frequency === 'monthly' ? '毎月' : `${(f.months ?? []).join('・')}月`}
                    {f.day_of_month >= 31 ? '末日' : `${f.day_of_month}日`}
                    {f.holiday_rule === 'next' && '（休日なら翌営業日）'}
                    {f.holiday_rule === 'prev' && '（休日なら前営業日）'} ・ {f.kind} ・ {f.payer}
                    {f.valid_from > new Date().toISOString().slice(0, 10) && ` ・ ${monthJa(f.valid_from)}から`}
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
            設定はすぐ反映されます。取込は1時間ごと、またはカレンダーの「りそなを読み込む」で動きます。
          </p>
        </>
      )}

      {tab === 'alert' && <AlertSettings conf={conf} onChanged={load} />}

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
  const thisMonth = ym(now);
  const nextMonth = ym(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const [amount, setAmount] = useState(String(budget.amount ?? budget.next_amount ?? 0));
  const [from, setFrom] = useState(nextMonth);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (from < thisMonth) { setError('今月より前は選べません'); return; }
    setBusy(true);
    try {
      await changeBudget(budget.category_id, Number(amount), fromYm(from));
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
          今の金額は {budget.amount === null ? 'なし' : `${yen(budget.amount)} 円`}
          {budget.next_from && `（${monthJa(budget.next_from)}から ${yen(budget.next_amount ?? 0)} 円の予定）`}。
          変えても、それより前の月の記帳はそのまま残ります。
        </p>

        <div className="field">
          <label htmlFor="ba">新しい金額</label>
          <input id="ba" type="number" inputMode="numeric" value={amount}
            onChange={(e) => setAmount(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="bf">いつから</label>
          <input id="bf" type="month" min={thisMonth} value={from}
            onChange={(e) => setFrom(e.target.value)} />
        </div>

        <p className="figure-sub" style={{ marginTop: 8 }}>
          選んだ月の25日から始まる期間に効きます（10月を選ぶと 10/25〜11/24 から）。
          この月より後に予約されている変更は、この金額で上書きされます。
          自動で記帳される項目（拠出・家賃など）は、記帳される額も一緒に変わります。
        </p>

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
  entry: FixedEntry; onClose: () => void; onSaved: () => void;
}) {
  const thisMonth = ym(new Date());
  const [name, setName] = useState(entry.name);
  const [amount, setAmount] = useState(String(entry.amount));
  const [day, setDay] = useState(String(entry.day_of_month));
  const [rule, setRule] = useState<FixedEntry['holiday_rule']>(entry.holiday_rule ?? 'none');
  const [from, setFrom] = useState(entry.valid_from.slice(0, 7) > thisMonth ? entry.valid_from.slice(0, 7) : thisMonth);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (from < thisMonth) { setError('今月より前は選べません'); return; }
    setBusy(true);
    try {
      await changeFixed(entry, {
        name,
        amount: Number(amount),
        day_of_month: Number(day),
        holiday_rule: rule,
      }, fromYm(from));
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
          <h2>自動計上の変更</h2>
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
          <label htmlFor="fd">記帳する日</label>
          <select id="fd" value={day} onChange={(e) => setDay(e.target.value)}>
            {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}日</option>
            ))}
            <option value="31">末日</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="fr">土日・祝日に当たったら</label>
          <select id="fr" value={rule} onChange={(e) => setRule(e.target.value as FixedEntry['holiday_rule'])}>
            <option value="none">そのままの日にする</option>
            <option value="next">翌営業日にずらす（引き落としなど）</option>
            <option value="prev">前営業日にずらす（給料日など）</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="ff">いつから</label>
          <input id="ff" type="month" min={thisMonth} value={from}
            onChange={(e) => setFrom(e.target.value)} />
        </div>

        <p className="figure-sub" style={{ marginTop: 8 }}>
          末日を選ぶと、2月は28日、4月は30日のように月ごとに合わせます。
          祝日は振替休日も含めて自動で判定します。
          この月からの記帳は新しい内容で作り直されます。それより前はそのままです。
        </p>

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

/* ---------- 通知の設定 ---------- */
const NUMBERS: { key: string; label: string; sub: string; unit: string }[] = [
  { key: 'alert_budget_rate', label: '予算の何%で知らせるか', sub: '変動費の合計がこの割合を超えたら', unit: '%' },
  { key: 'alert_pace_points', label: 'ペースの警告', sub: '期間の経過より何ポイント早く使ったら', unit: 'ポイント' },
  { key: 'alert_pace_min_over', label: 'ペースの警告を出す見込み額', sub: 'このままだとこの額以上オーバーするとき', unit: '円' },
  { key: 'alert_pace_min_days', label: 'ペースの警告を出さない日数', sub: '期間の最初の何日かは出さない（まとめ買いで誤報しないように）', unit: '日' },
  { key: 'alert_spendable_min', label: '使えるお金の下限', sub: 'この額を切ったら知らせる', unit: '円' },
  { key: 'alert_deposit_hour', label: '入金のお知らせの時刻', sub: '毎月24日のこの時刻に、明日入れる額を知らせる', unit: '時' },
];

function AlertSettings({ conf, onChanged }: { conf: Record<string, string>; onChanged: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    const v: Record<string, string> = {};
    for (const n of NUMBERS) v[n.key] = conf[n.key] ?? '';
    setVals(v);
  }, [conf]);

  const toggle = async (key: string, on: boolean) => {
    await setSetting(key, on ? 'true' : 'false');
    onChanged();
  };
  const save = async (key: string) => {
    if (vals[key] === '' || vals[key] === conf[key]) return;
    await setSetting(key, String(Number(vals[key])));
    onChanged();
  };

  return (
    <>
      <p className="eyebrow">通知の送り方</p>
      <div className="ledger">
        <label className="switch">
          <span>
            <span className="name">通知を使う</span><br />
            <span className="sub">オフにするとアプリにもLINEにも出なくなります</span>
          </span>
          <input type="checkbox" checked={conf.alerts_enabled !== 'false'}
            onChange={(e) => toggle('alerts_enabled', e.target.checked)} />
        </label>
        <label className="switch">
          <span>
            <span className="name">LINEにも送る</span><br />
            <span className="sub">
              グループ：{conf.line_group === 'registered' ? '登録済み' : '未登録（グループで「家計簿を登録」と送る）'}
            </span>
          </span>
          <input type="checkbox" checked={conf.line_enabled !== 'false'}
            onChange={(e) => toggle('line_enabled', e.target.checked)} />
        </label>
        <label className="switch">
          <span>
            <span className="name">夜は朝にまとめて送る</span><br />
            <span className="sub">23時〜7時の通知は、朝7時以降にLINEへ送ります。アプリにはすぐ出ます</span>
          </span>
          <input type="checkbox" checked={conf.alert_quiet_night !== 'false'}
            onChange={(e) => toggle('alert_quiet_night', e.target.checked)} />
        </label>
      </div>

      <p className="eyebrow">通知の基準</p>
      <div className="ledger">
        {NUMBERS.map((n) => (
          <label className="switch" key={n.key}>
            <span>
              <span className="name">{n.label}</span><br />
              <span className="sub">{n.sub}</span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <input
                type="number" inputMode="numeric"
                className="num-input num"
                value={vals[n.key] ?? ''}
                onChange={(e) => setVals((v) => ({ ...v, [n.key]: e.target.value }))}
                onBlur={() => save(n.key)}
              />
              <span className="sub">{n.unit}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="figure-sub" style={{ marginTop: 10 }}>
        同じ通知は1つの期間（25日〜翌月24日）に1回だけ届きます。基準を変えても、その期間にすでに届いた通知はもう一度は来ません。
      </p>
    </>
  );
}
