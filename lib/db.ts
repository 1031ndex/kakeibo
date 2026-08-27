import { supabase } from './supabase';

export type Owner = '共通' | 'りほ' | 'ゆうき';
export type Kind = '支出' | '収入';
export type AccountKind = 'resona' | 'savings' | 'invest';

export const ACCOUNT = { RESONA: 1, SAVINGS: 2, INVEST: 3 } as const;

export type Category = {
  id: number;
  name: string;
  account_id: number;
  kind: Kind;
  is_variable: boolean;
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
  categories: { name: string; is_variable: boolean } | null;
};

export type Budget = {
  category_id: number;
  name: string;
  account_kind: AccountKind;
  is_variable: boolean;
  amount: number | null;
};

/* ---------- 日付 ---------- */
const p2 = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
export const monthLabel = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`;
export const yen = (n: number) => n.toLocaleString('ja-JP');

const TX_SELECT =
  'id,occurred_on,account_id,type,category_id,merchant,amount,payer,memo,is_refund,source,categories(name,is_variable)';

/* ---------- 取得 ---------- */
export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,account_id,kind,is_variable,sort_order')
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

export async function fetchAnnualTargets(year: number) {
  const { data, error } = await supabase
    .from('annual_targets')
    .select('category_id,amount,categories(name)')
    .eq('year', year);
  if (error) throw error;
  return (data ?? []) as unknown as { category_id: number; amount: number; categories: { name: string } }[];
}

/* ---------- 更新 ---------- */
export async function generateFixed(month: Date) {
  const { error } = await supabase.rpc('fn_generate_fixed', { target_month: iso(monthStart(month)) });
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

export async function removeTx(id: string) {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- マスタ編集 ---------- */
/**
 * 予算を変更する。行を書き換えず、旧行を閉じて新行を足す。
 * こうしないと過去月の集計まで変わってしまう。
 */
export async function changeBudget(categoryId: number, amount: number, from: Date) {
  const fromDate = monthStart(from);
  const prevDay = new Date(fromDate.getFullYear(), fromDate.getMonth(), 0);

  const { data: rows, error: e1 } = await supabase
    .from('category_budgets')
    .select('id,valid_from,valid_to')
    .eq('category_id', categoryId)
    .is('valid_to', null);
  if (e1) throw e1;

  for (const r of rows ?? []) {
    if (r.valid_from >= iso(fromDate)) {
      const { error } = await supabase.from('category_budgets').delete().eq('id', r.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('category_budgets').update({ valid_to: iso(prevDay) }).eq('id', r.id);
      if (error) throw error;
    }
  }

  const { error: e2 } = await supabase
    .from('category_budgets')
    .insert({ category_id: categoryId, amount, valid_from: iso(fromDate) });
  if (e2) throw e2;
}

export async function fetchFixedEntries() {
  const { data, error } = await supabase
    .from('fixed_entries')
    .select('id,name,kind,category_id,amount,payer,day_of_month,valid_from,valid_to')
    .is('valid_to', null)
    .order('id');
  if (error) throw error;
  return data ?? [];
}

export async function changeFixedAmount(id: number, amount: number) {
  const { error } = await supabase.from('fixed_entries').update({ amount }).eq('id', id);
  if (error) throw error;
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

/* ---------- 固定収支の編集 ---------- */
export async function updateFixed(id: number, patch: { name?: string; amount?: number; day_of_month?: number }) {
  const { error } = await supabase.from('fixed_entries').update(patch).eq('id', id);
  if (error) throw error;
}

/** 計上日や金額を変えたあと、その月の記帳を作り直す */
export async function regenerateMonth(fixedId: number, month: Date) {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('fixed_entry_id', fixedId)
    .eq('period_month', iso(monthStart(month)));
  if (error) throw error;
  await generateFixed(month);
}

/* ---------- 精算 ---------- */
export type Settlement = {
  user_name: Owner;
  base_amount: number;
  advanced: number;
  to_pay: number;
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
