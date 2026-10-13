import { supabase } from './supabase';

export type Owner = '共通' | 'りほ' | 'ゆうき';
export type Kind = '支出' | '収入';
export type AccountKind = 'resona' | 'savings' | 'invest';

// 2 は旧貯蓄口座。v3 で共通りそなに統合したため使わない
export const ACCOUNT = { RESONA: 1, INVEST: 3 } as const;

export type Category = {
  id: number;
  name: string;
  account_id: number;
  kind: Kind;
  is_variable: boolean;        // 日々の変動費
  is_annual: boolean;          // 年間支出（貯蓄から出る）
  is_contribution: boolean;    // 拠出
  is_savings_income: boolean;  // 貯蓄に入る収入（ボーナス・還付金）
  is_system: boolean;          // 残高調整など。手入力の選択肢には出さない
  sort_order: number;
};

export type Tx = {
  id: string;
  occurred_on: string;      // 'YYYY-MM-DD'
  account_id: number;
  type: Kind;
  category_id: number | null;
  merchant: string;
  amount: number;
  payer: Owner;
  memo: string;
  is_refund: boolean;
  source: 'auto' | 'manual' | 'fixed';
  period_month: string | null;  // 自動計上のとき、どの月の分か
  categories: {
    name: string;
    is_variable: boolean;
    is_annual: boolean;
    is_contribution: boolean;
    is_savings_income: boolean;
    is_system: boolean;
  } | null;
};

export type Budget = {
  category_id: number;
  name: string;
  account_kind: AccountKind;
  kind: Kind;
  is_variable: boolean;
  is_annual: boolean;
  is_contribution: boolean;
  amount: number | null;       // 指定月に効いている金額
  next_amount: number | null;  // その先に予約されている変更
  next_from: string | null;
};

export type FixedEntry = {
  id: number;
  name: string;
  kind: Kind;
  category_id: number;
  amount: number;
  payer: Owner;
  day_of_month: number;
  frequency: 'monthly' | 'specific_months' | 'yearly';
  months: number[] | null;
  holiday_rule: 'none' | 'next' | 'prev';
  valid_from: string;
  valid_to: string | null;
};

/* ---------- 日付 ---------- */
const p2 = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
export const monthLabel = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`;
export const yen = (n: number) => n.toLocaleString('ja-JP');
const prevDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);

/* ---------- 家計の1か月（25日〜翌月24日）----------
 * 期間は「始まりの月」で呼ぶ。2026年9月の期間 = 9/25〜10/24。
 * 予算や拠出は、選んだ月の25日から始まる期間に効く。
 */
export const cycleStart = (key: Date) => new Date(key.getFullYear(), key.getMonth(), 25);
export const cycleEnd = (key: Date) => new Date(key.getFullYear(), key.getMonth() + 1, 24);
export const cycleKeyOf = (d: Date) =>
  d.getDate() >= 25 ? monthStart(d) : new Date(d.getFullYear(), d.getMonth() - 1, 1);
export const cycleLabel = (key: Date) => {
  const s = cycleStart(key), e = cycleEnd(key);
  return `${s.getMonth() + 1}/${s.getDate()}〜${e.getMonth() + 1}/${e.getDate()}`;
};

const TX_SELECT =
  'id,occurred_on,account_id,type,category_id,merchant,amount,payer,memo,is_refund,source,period_month,' +
  'categories(name,is_variable,is_annual,is_contribution,is_savings_income,is_system)';

/* ---------- 取得 ---------- */
export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,account_id,kind,is_variable,is_annual,is_contribution,is_savings_income,is_system,sort_order')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data as Category[];
}

export async function fetchMonthTx(accountId: number, month: Date): Promise<Tx[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(TX_SELECT)
    .eq('account_id', accountId)
    .gte('occurred_on', iso(monthStart(month)))
    .lte('occurred_on', iso(monthEnd(month)))
    .order('occurred_on', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Tx[];
}

/** 日付の範囲で取る（両端を含む） */
export async function fetchRangeTx(accountId: number, from: Date, to: Date): Promise<Tx[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(TX_SELECT)
    .eq('account_id', accountId)
    .gte('occurred_on', iso(from))
    .lte('occurred_on', iso(to))
    .order('occurred_on', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Tx[];
}

export async function fetchYearTx(accountId: number, year: number): Promise<Tx[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(TX_SELECT)
    .eq('account_id', accountId)
    .gte('occurred_on', `${year}-01-01`)
    .lte('occurred_on', `${year}-12-31`)
    .order('occurred_on', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Tx[];
}

export async function fetchUnclassified(): Promise<Tx[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select(TX_SELECT)
    .is('category_id', null)
    .order('occurred_on', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Tx[];
}

export async function fetchBudgets(month: Date): Promise<Budget[]> {
  const { data, error } = await supabase.rpc('fn_budgets', { target_month: iso(monthStart(month)) });
  if (error) throw error;
  return (data ?? []) as Budget[];
}

export async function fetchCarryover(accountId: number, month: Date): Promise<number> {
  const { data, error } = await supabase.rpc('fn_carryover', {
    target_account: accountId,
    target_month: iso(monthStart(month)),
  });
  if (error) throw error;
  return (data ?? 0) as number;
}

export async function fetchBalance(accountId: number): Promise<number> {
  const { data, error } = await supabase.rpc('fn_balance', { target_account: accountId });
  if (error) throw error;
  return (data ?? 0) as number;
}

/**
 * 年間支出の目安。その年の登録がなければ、それより前の一番新しい年の値を使う。
 * （毎年登録し直さなくても目安が出るように）
 */
export async function fetchAnnualTargets(year: number) {
  const { data, error } = await supabase
    .from('annual_targets')
    .select('year,category_id,amount,categories(name,sort_order)')
    .lte('year', year)
    .order('year', { ascending: false });
  if (error) throw error;

  type Row = { year: number; category_id: number; amount: number; categories: { name: string; sort_order: number } };
  const latest = new Map<number, Row>();
  for (const r of (data ?? []) as unknown as Row[]) {
    if (!latest.has(r.category_id)) latest.set(r.category_id, r);
  }
  return Array.from(latest.values()).sort(
    (a, b) => (a.categories?.sort_order ?? 0) - (b.categories?.sort_order ?? 0)
  );
}

/* ---------- お金の集計 ---------- */
export type Money = {
  balance: number;       // 共通りそなの残高
  monthly_plan: number;  // その月の貯蓄額（拠出 − 生活費の予算）
  saved: number;         // これまでに貯めた額（ボーナス・還付金を含む）
  used: number;          // これまでの年間支出
  savings: number;       // 貯蓄の残り
  spendable: number;     // 使えるお金
};

/** 指定日の時点のお金。期間の締め日（24日）を渡すと、その期間の終わりの見込みが出る */
export async function fetchMoneyAt(day: Date): Promise<Money> {
  const { data, error } = await supabase.rpc('fn_money_at', { end_date: iso(day) });
  if (error) throw error;
  const row = (data ?? [])[0];
  return row ?? { balance: 0, monthly_plan: 0, saved: 0, used: 0, savings: 0, spendable: 0 };
}

/** 指定日の終わり時点の共通りそなの残高 */
export async function fetchBalanceOn(day: Date): Promise<number> {
  const { data, error } = await supabase.rpc('fn_balance_on', { d: iso(day) });
  if (error) throw error;
  return (data ?? 0) as number;
}

/**
 * 通帳の残高に合わせる。アプリの残高との差を「残高調整」として記録する。
 * 取り込めていない入出金や、アプリを始める前のお金をまとめて埋めるためのもの。
 */
export async function adjustBalance(actual: number, day: Date): Promise<number> {
  const current = await fetchBalanceOn(day);
  const diff = actual - current;
  if (diff === 0) return 0;

  const { data: cat, error: e0 } = await supabase
    .from('categories').select('id').eq('name', '残高調整').single();
  if (e0) throw e0;

  const { error } = await supabase.from('transactions').insert({
    occurred_on: iso(day),
    account_id: ACCOUNT.RESONA,
    type: diff > 0 ? '収入' : '支出',
    category_id: cat.id,
    merchant: '通帳の残高に合わせる',
    amount: Math.abs(diff),
    payer: '共通',
    memo: `通帳 ${actual.toLocaleString('ja-JP')} 円 に合わせた`,
    source: 'manual',
  });
  if (error) throw error;
  return diff;
}

/* ---------- 記帳 ---------- */
/** 運用開始月から指定月までの固定収支を計上する（間の月が抜けないように） */
export async function generateFixed(month: Date) {
  const { error } = await supabase.rpc('fn_generate_until', { target_month: iso(monthStart(month)) });
  if (error) throw error;
}

export async function classify(txId: string, categoryId: number) {
  const { error } = await supabase.from('transactions').update({ category_id: categoryId }).eq('id', txId);
  if (error) throw error;
}

export async function learnRule(pattern: string, categoryId: number) {
  const { error } = await supabase
    .from('merchant_rules')
    .insert({ pattern: pattern.toUpperCase(), category_id: categoryId, priority: 1 });
  if (error && !String(error.message).includes('duplicate')) throw error;
}

export async function addTx(input: {
  occurred_on: string;
  account_id: number;
  type: Kind;
  category_id: number;
  amount: number;
  payer: Owner;
  merchant: string;
  memo: string;
}) {
  const { error } = await supabase.from('transactions').insert({ ...input, source: 'manual' });
  if (error) throw error;
}

/**
 * 記帳を消す。
 * デビットから取り込んだものは、消したことを記録しておく。
 * 記録しないと次の取込で同じメールをまた拾ってしまう。
 */
export async function removeTx(id: string) {
  const { data, error: e0 } = await supabase
    .from('transactions').select('gmail_message_id,merchant').eq('id', id).maybeSingle();
  if (e0) throw e0;
  if (data?.gmail_message_id) {
    const { error: e1 } = await supabase.from('import_errors').insert({
      gmail_message_id: data.gmail_message_id,
      subject: data.merchant,
      reason: 'アプリで削除したため再取込しない',
    });
    if (e1) throw e1;
  }
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- マスタ編集 ----------
 * 金額や日付を変えるときは行を書き換えず、旧行を前月末で閉じて新しい行を足す。
 * こうしないと過去の月の集計まで変わってしまう。
 */

/** 予算をその月から切り替える。その月以降に予約されていた変更は上書きする */
async function splitBudget(categoryId: number, amount: number, from: Date) {
  const f = iso(monthStart(from));
  const { data: rows, error } = await supabase
    .from('category_budgets')
    .select('id,valid_from,valid_to')
    .eq('category_id', categoryId)
    .or(`valid_to.is.null,valid_to.gte.${f}`);
  if (error) throw error;

  for (const r of rows ?? []) {
    const q = r.valid_from >= f
      ? supabase.from('category_budgets').delete().eq('id', r.id)
      : supabase.from('category_budgets').update({ valid_to: iso(prevDay(monthStart(from))) }).eq('id', r.id);
    const { error: e } = await q;
    if (e) throw e;
  }

  const { error: e2 } = await supabase
    .from('category_budgets')
    .insert({ category_id: categoryId, amount, valid_from: f });
  if (e2) throw e2;
}

/** 固定収支をその月から切り替える。その月以降に作られていた記帳は消して作り直させる */
async function splitFixed(entry: FixedEntry, patch: Partial<FixedEntry>, from: Date) {
  const f = iso(monthStart(from));

  const { error: e0 } = await supabase
    .from('transactions').delete()
    .eq('fixed_entry_id', entry.id)
    .gte('period_month', f);
  if (e0) throw e0;

  if (entry.valid_from >= f) {
    const { error } = await supabase.from('fixed_entries').update(patch).eq('id', entry.id);
    if (error) throw error;
    return;
  }

  const { error: e1 } = await supabase
    .from('fixed_entries').update({ valid_to: iso(prevDay(monthStart(from))) }).eq('id', entry.id);
  if (e1) throw e1;

  const { id: _id, ...rest } = entry;
  const { error: e2 } = await supabase
    .from('fixed_entries')
    .insert({ ...rest, ...patch, valid_from: f, valid_to: null });
  if (e2) throw e2;
}

const ENTRY_SELECT =
  'id,name,kind,category_id,amount,payer,day_of_month,frequency,months,holiday_rule,valid_from,valid_to';

/**
 * 予算の金額を変える。
 * 同じカテゴリに自動計上（拠出・家賃・積立など）があれば、それも同じ金額に揃える。
 * 揃えないと「予算は変わったのに引き落とされる額は古いまま」になる。
 */
export async function changeBudget(categoryId: number, amount: number, from: Date) {
  await splitBudget(categoryId, amount, from);

  const f = iso(monthStart(from));
  const { data, error } = await supabase
    .from('fixed_entries')
    .select(ENTRY_SELECT)
    .eq('category_id', categoryId)
    .or(`valid_to.is.null,valid_to.gte.${f}`)
    .order('valid_from');
  if (error) throw error;
  const rows = (data ?? []) as FixedEntry[];

  // 1つのカテゴリに別々の自動計上がある場合（誕生日など）は触らない
  if (rows.length > 0 && new Set(rows.map((r) => `${r.name}|${r.payer}`)).size === 1) {
    const template = rows[rows.length - 1];
    for (const r of rows) {
      const { error: e0 } = await supabase
        .from('transactions').delete().eq('fixed_entry_id', r.id).gte('period_month', f);
      if (e0) throw e0;
      const q = r.valid_from >= f
        ? supabase.from('fixed_entries').delete().eq('id', r.id)
        : supabase.from('fixed_entries').update({ valid_to: iso(prevDay(monthStart(from))) }).eq('id', r.id);
      const { error: e1 } = await q;
      if (e1) throw e1;
    }
    const { id: _id, ...rest } = template;
    const { error: e2 } = await supabase
      .from('fixed_entries')
      .insert({ ...rest, amount, valid_from: f, valid_to: null });
    if (e2) throw e2;
  }

  await generateFixed(new Date());
}

/** 自動計上の名前・金額・計上日を変える。金額を変えたら予算も揃える */
export async function changeFixed(
  entry: FixedEntry,
  patch: { name: string; amount: number; day_of_month: number; holiday_rule: FixedEntry['holiday_rule'] },
  from: Date,
) {
  await splitFixed(entry, patch, from);

  if (patch.amount !== entry.amount) {
    const { data, error } = await supabase
      .from('category_budgets').select('id').eq('category_id', entry.category_id).limit(1);
    if (error) throw error;
    if ((data ?? []).length > 0) await splitBudget(entry.category_id, patch.amount, from);
  }

  await generateFixed(new Date());
}

export async function fetchFixedEntries(): Promise<FixedEntry[]> {
  const { data, error } = await supabase
    .from('fixed_entries')
    .select(ENTRY_SELECT)
    .is('valid_to', null)
    .order('id');
  if (error) throw error;
  return (data ?? []) as FixedEntry[];
}

export async function fetchRules() {
  const { data, error } = await supabase
    .from('merchant_rules')
    .select('id,pattern,category_id,categories(name)')
    .order('pattern');
  if (error) throw error;
  return (data ?? []) as unknown as { id: number; pattern: string; category_id: number; categories: { name: string } }[];
}

export async function removeRule(id: number) {
  const { error } = await supabase.from('merchant_rules').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- 設定 ---------- */
export async function fetchSettings(): Promise<Record<string, string>> {
  const { data, error } = await supabase.from('settings').select('key,value');
  if (error) throw error;
  const o: Record<string, string> = {};
  for (const r of data ?? []) o[(r as any).key] = (r as any).value;
  return o;
}

export async function setSetting(key: string, value: string) {
  const { error } = await supabase.rpc('fn_set_setting', { k: key, v: value });
  if (error) throw error;
}

/* ---------- 精算 ---------- */
export type Settlement = {
  user_name: Owner;
  base_amount: number;   // 拠出の基準額
  advanced: number;      // 本人が払った共通の支出（立替・誕生日プレゼント）
  to_pay: number;        // その月に入れる額
};

export async function fetchSettlement(month: Date): Promise<Settlement[]> {
  const { data, error } = await supabase.rpc('fn_settlement', { target_month: iso(monthStart(month)) });
  if (error) throw error;
  return (data ?? []) as Settlement[];
}

/* ---------- グラフ ---------- */
export async function fetchTrend(accountId: number, monthsBack = 12) {
  const { data, error } = await supabase.rpc('fn_monthly_trend', {
    target_account: accountId,
    months_back: monthsBack,
  });
  if (error) throw error;
  return (data ?? []) as { month: string; income: number; outgo: number }[];
}

/* ---------- りそなメールの手動取込 ---------- */
export async function runImport(): Promise<{ imported: number; errors: number }> {
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new Error('ログインし直してください');

  const res = await fetch('/api/refresh', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({ ok: false, error: '応答を読み取れません' }));
  if (!data.ok) throw new Error(data.error ?? '取込に失敗しました');
  return { imported: data.imported ?? 0, errors: data.errors ?? 0 };
}

/* ---------- 通知 ---------- */
export type Alert = {
  id: number;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  sent_at: string | null;
  read: boolean;          // 自分が読んだか（既読は2人それぞれ）
};

/** 今の期間の通知の条件を調べる。新しく満たしたものだけが追加される */
export async function checkAlerts() {
  const { error } = await supabase.rpc('fn_check_alerts', {});
  if (error) throw error;
}

export async function fetchAlerts(limit = 30): Promise<Alert[]> {
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  const { data, error } = await supabase
    .from('alerts')
    .select('id,kind,title,body,created_at,sent_at,alert_reads(user_id)')
    .order('id', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as any[]).map((a) => ({
    id: a.id, kind: a.kind, title: a.title, body: a.body,
    created_at: a.created_at, sent_at: a.sent_at,
    read: (a.alert_reads ?? []).some((r: any) => r.user_id === uid),
  }));
}

export async function markAlertsRead(ids: number[]) {
  if (ids.length === 0) return;
  const { data: s } = await supabase.auth.getSession();
  const uid = s.session?.user.id;
  if (!uid) return;
  const { error } = await supabase
    .from('alert_reads')
    .upsert(ids.map((id) => ({ alert_id: id, user_id: uid })),
      { onConflict: 'alert_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
}
