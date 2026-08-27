import { supabase } from './supabase';

export type Owner = '共通' | 'りほ' | 'ゆうき';
export type Kind = '支出' | '収入' | '貯蓄';

export type Category = {
  id: number;
  name: string;
  owner: Owner;
  kind: Kind;
  pocket_id: number;
  is_variable: boolean;
  sort_order: number;
};

export type Tx = {
  id: string;
  occurred_at: string;
  type: Kind;
  category_id: number | null;
  category_name: string | null;
  category_kind: Kind | null;
  is_variable: boolean | null;
  pocket_kind: 'living' | 'annual' | 'savings';
  merchant: string;
  amount: number;
  payer: Owner;
  memo: string;
  is_refund: boolean;
  source: 'auto' | 'manual' | 'fixed';
};

export type Budget = {
  category_id: number;
  name: string;
  owner: Owner;
  kind: Kind;
  is_variable: boolean;
  pocket_kind: string;
  monthly_amount: number | null;
};

/* ---------- 日付ユーティリティ ---------- */
export const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
export const monthEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 1);
export const iso = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const yen = (n: number) => n.toLocaleString('ja-JP');
export const monthLabel = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月`;

/* ---------- 取得 ---------- */
export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id,name,owner,kind,pocket_id,is_variable,sort_order')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data as Category[];
}

export async function fetchMonthTx(month: Date): Promise<Tx[]> {
  const { data, error } = await supabase
    .from('v_transactions')
    .select('id,occurred_at,type,category_id,category_name,category_kind,is_variable,pocket_kind,merchant,amount,payer,memo,is_refund,source')
    .gte('occurred_at', monthStart(month).toISOString())
    .lt('occurred_at', monthEnd(month).toISOString())
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return data as Tx[];
}

export async function fetchUnclassified(): Promise<Tx[]> {
  const { data, error } = await supabase
    .from('v_transactions')
    .select('id,occurred_at,type,category_id,category_name,category_kind,is_variable,pocket_kind,merchant,amount,payer,memo,is_refund,source')
    .is('category_id', null)
    .order('occurred_at', { ascending: false });
  if (error) throw error;
  return data as Tx[];
}

export async function fetchBudgets(): Promise<Budget[]> {
  const { data, error } = await supabase
    .from('v_current_budgets')
    .select('category_id,name,owner,kind,is_variable,pocket_kind,monthly_amount');
  if (error) throw error;
  return data as Budget[];
}

/** 年初からの貯蓄実績と、その年の目標合計 */
export async function fetchSavings(year: number) {
  const from = new Date(year, 0, 1).toISOString();
  const to = new Date(year + 1, 0, 1).toISOString();

  const [{ data: txs, error: e1 }, { data: goals, error: e2 }] = await Promise.all([
    supabase.from('v_transactions').select('amount').eq('type', '貯蓄')
      .gte('occurred_at', from).lt('occurred_at', to),
    supabase.from('savings_goals').select('target_amount').eq('year', year),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;

  const actual = (txs ?? []).reduce((s, t: any) => s + t.amount, 0);
  const target = (goals ?? []).reduce((s, g: any) => s + g.target_amount, 0);
  return { actual, target };
}

/* ---------- 更新 ---------- */
export async function classify(txId: string, categoryId: number, pocketId: number) {
  const { error } = await supabase
    .from('transactions')
    .update({ category_id: categoryId, pocket_id: pocketId })
    .eq('id', txId);
  if (error) throw error;
}

export async function learnRule(pattern: string, categoryId: number) {
  const { error } = await supabase
    .from('merchant_rules')
    .insert({ pattern: pattern.toUpperCase(), category_id: categoryId, priority: 1 });
  // 同じ店名のルールが既にある場合は何もしない
  if (error && !String(error.message).includes('duplicate')) throw error;
}

export async function addManual(input: {
  occurred_at: string;
  category_id: number;
  amount: number;
  payer: Owner;
  merchant: string;
  memo: string;
  type: Kind;
  pocket_id: number;
}) {
  const { error } = await supabase.from('transactions').insert({ ...input, source: 'manual' });
  if (error) throw error;
}

export async function removeTx(id: string) {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}

/** その月の固定収支を計上する（未計上のものだけ入る） */
export async function generateFixed(month: Date) {
  const { error } = await supabase.rpc('fn_generate_fixed', { target_month: iso(monthStart(month)) });
  if (error) throw error;
}
