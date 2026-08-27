-- ============================================================
-- 家計簿アプリ 初期マスタ投入 v1.2
-- 01_schema.sql の実行後に流す
-- 運用開始: 2026-10-01
-- ============================================================

-- ---------- users ----------
insert into users (name) values ('りほ'), ('ゆうき');

-- ---------- pockets ----------
insert into pockets (id, name, kind, sort_order) values
  (1, '生活費',   'living',  1),
  (2, '年間支出', 'annual',  2),
  (3, '貯蓄',     'savings', 3);
select setval('pockets_id_seq', 3);

-- ---------- categories ----------
-- 共通・生活費（共通りそな口座から支払う）
insert into categories (name, owner, kind, pocket_id, is_variable, sort_order) values
  ('家賃+火災保険', '共通', '支出', 1, false, 10),
  ('食費',          '共通', '支出', 1, true,  11),
  ('外食',          '共通', '支出', 1, true,  12),
  ('出前',          '共通', '支出', 1, true,  13),
  ('日用品',        '共通', '支出', 1, true,  14),
  ('光熱費',        '共通', '支出', 1, false, 15),
  ('娯楽・買い物',  '共通', '支出', 1, true,  16),
  ('生命保険',      '共通', '支出', 1, false, 17);

-- 共通・貯蓄（支出集計には含めない）
insert into categories (name, owner, kind, pocket_id, is_variable, sort_order) values
  ('個人年金',   '共通', '貯蓄', 3, false, 30),
  ('自社株',     '共通', '貯蓄', 3, false, 31),
  ('投資信託',   '共通', '貯蓄', 3, false, 32),
  ('銀行預金',   '共通', '貯蓄', 3, false, 33);

-- 収入
insert into categories (name, owner, kind, pocket_id, is_variable, sort_order) values
  ('給与',     '共通', '収入', 1, false, 1),
  ('ボーナス', '共通', '収入', 1, false, 2),
  ('還付金',   '共通', '収入', 1, false, 3);

-- りほ個人
insert into categories (name, owner, kind, pocket_id, is_variable, sort_order) values
  ('スマホ（りほ）',   'りほ', '支出', 1, false, 40),
  ('美容室（りほ）',   'りほ', '支出', 1, false, 41),
  ('ネイル（りほ）',   'りほ', '支出', 1, false, 42),
  ('マツパ（りほ）',   'りほ', '支出', 1, false, 43),
  ('交通費（りほ）',   'りほ', '支出', 1, false, 44),
  ('お小遣い（りほ）', 'りほ', '支出', 1, false, 45);

-- ゆうき個人
insert into categories (name, owner, kind, pocket_id, is_variable, sort_order) values
  ('スマホ（ゆうき）',   'ゆうき', '支出', 1, false, 50),
  ('美容室（ゆうき）',   'ゆうき', '支出', 1, false, 51),
  ('奨学金（ゆうき）',   'ゆうき', '支出', 1, false, 52),
  ('交通費（ゆうき）',   'ゆうき', '支出', 1, false, 53),
  ('お小遣い（ゆうき）', 'ゆうき', '支出', 1, false, 54);

-- 年間支出（積立せず、発生時に各自の個人口座から支払う。精算対象外）
insert into categories (name, owner, kind, pocket_id, is_variable, sort_order) values
  ('旅行',           '共通', '支出', 2, false, 60),
  ('住民税（りほ）', 'りほ', '支出', 2, false, 61),
  ('娯楽（年間）',   '共通', '支出', 2, false, 62),
  ('医療費',         '共通', '支出', 2, false, 63),
  ('ふるさと納税',   '共通', '支出', 2, false, 64),
  ('イベント',       '共通', '支出', 2, false, 65),
  ('税理士',         '共通', '支出', 2, false, 66);

-- ---------- category_budgets ----------
-- 月額予算
insert into category_budgets (category_id, amount, period, valid_from)
select id, v.amount, 'monthly', date '2026-10-01'
from categories c
join (values
  ('家賃+火災保険',      135000),
  ('食費',                30000),
  ('外食',                25000),
  ('出前',                10000),
  ('日用品',              10000),
  ('光熱費',              20000),
  ('娯楽・買い物',        10000),
  ('生命保険',             7000),
  ('個人年金',            14000),
  ('自社株',              30000),
  ('投資信託',            10000),
  ('スマホ（りほ）',      13000),
  ('美容室（りほ）',      12000),
  ('ネイル（りほ）',       9000),
  ('マツパ（りほ）',       4000),
  ('交通費（りほ）',      20000),
  ('お小遣い（りほ）',    25000),
  ('スマホ（ゆうき）',    10000),
  ('美容室（ゆうき）',    10000),
  ('奨学金（ゆうき）',    15000),
  ('交通費（ゆうき）',    18000),
  ('お小遣い（ゆうき）',  25000)
) as v(name, amount) on v.name = c.name;

-- 年額の目安（予算ではなく参考値）
insert into category_budgets (category_id, amount, period, valid_from)
select id, v.amount, 'yearly', date '2026-10-01'
from categories c
join (values
  ('旅行',           150000),
  ('住民税（りほ）',  79300),
  ('娯楽（年間）',   100000),
  ('医療費',          15000),
  ('ふるさと納税',    30000),
  ('イベント',       132000),
  ('税理士',          45000)
) as v(name, amount) on v.name = c.name;

-- ---------- fixed_entries ----------
-- auto_post = true のものだけが transactions に自動計上される。
-- 美容室・ネイル・マツパ・交通費は実際に使ったときに手入力するため、ここには入れない。

-- 収入
insert into fixed_entries (name, kind, category_id, amount, payer, day_of_month, frequency, months, is_variable_amount, valid_from)
select v.nm, '収入', c.id, v.amt, v.payer::owner_type, v.dom, v.freq::freq_type, v.mons, v.varamt, date '2026-10-01'
from (values
  ('りほ給料',   '給与',     320000, 'りほ',   25, 'monthly',         null::int[],       false),
  ('ゆうき給料', '給与',     260000, 'ゆうき', 25, 'monthly',         null::int[],       false),
  ('ボーナス',   'ボーナス', 100000, 'りほ',   10, 'specific_months', array[3,6,9,12],   true),
  ('還付金',     '還付金',   400000, 'りほ',   15, 'specific_months', array[3],          false)
) as v(nm, cat, amt, payer, dom, freq, mons, varamt)
join categories c on c.name = v.cat;

-- 共通支出（口座引落。デビットのメールが来ないため自動計上する）
insert into fixed_entries (name, kind, category_id, amount, payer, day_of_month, frequency, valid_from)
select v.nm, '支出', c.id, v.amt, v.payer::owner_type, v.dom, 'monthly', date '2026-10-01'
from (values
  ('家賃+火災保険', '家賃+火災保険', 135000, '共通',   1),
  ('光熱費',        '光熱費',         20000, '共通',   1),
  ('生命保険',      '生命保険',        7000, 'ゆうき', 1)
) as v(nm, cat, amt, payer, dom)
join categories c on c.name = v.cat;

-- 貯蓄（個人口座から引落）
insert into fixed_entries (name, kind, category_id, amount, payer, day_of_month, frequency, valid_from)
select v.nm, '貯蓄', c.id, v.amt, v.payer::owner_type, v.dom, 'monthly', date '2026-10-01'
from (values
  ('個人年金',   '個人年金',  14000, 'ゆうき', 1),
  ('自社株',     '自社株',    30000, 'りほ',   1),
  ('投資信託',   '投資信託',  10000, 'りほ',   1)
) as v(nm, cat, amt, payer, dom)
join categories c on c.name = v.cat;

-- 個人の固定費
insert into fixed_entries (name, kind, category_id, amount, payer, day_of_month, frequency, valid_from)
select v.nm, '支出', c.id, v.amt, v.payer::owner_type, v.dom, 'monthly', date '2026-10-01'
from (values
  ('スマホ（りほ）',     'スマホ（りほ）',     13000, 'りほ',    1),
  ('お小遣い（りほ）',   'お小遣い（りほ）',   25000, 'りほ',   25),
  ('スマホ（ゆうき）',   'スマホ（ゆうき）',   10000, 'ゆうき',  1),
  ('奨学金（ゆうき）',   '奨学金（ゆうき）',   15000, 'ゆうき', 27),
  ('お小遣い（ゆうき）', 'お小遣い（ゆうき）', 25000, 'ゆうき', 25)
) as v(nm, cat, amt, payer, dom)
join categories c on c.name = v.cat;

-- ---------- contributions ----------
-- 共通りそなから出る240,000を折半（各120,000）し、個人口座からの引落分を調整した額。
--   りほ  : 120,000 +7,000 +3,500 −15,000 −5,000 = 110,500
--   ゆうき: 120,000 −7,000 −3,500 +15,000 +5,000 = 129,500
insert into contributions (user_id, amount, valid_from)
select u.id, v.amt, date '2026-10-01'
from (values ('りほ', 110500), ('ゆうき', 129500)) as v(nm, amt)
join users u on u.name = v.nm::owner_type;

-- ---------- savings_goals ----------
-- 2026年は10〜12月の3ヶ月のみ
insert into savings_goals (year, category_id, target_amount)
select 2026, c.id, v.amt
from (values
  ('個人年金',   42000),
  ('自社株',     90000),
  ('投資信託',   30000),
  ('銀行預金',  454000)   -- 手残り118,000×3 ＋ 12月ボーナス100,000
) as v(nm, amt)
join categories c on c.name = v.nm;

-- 2027年は通年
insert into savings_goals (year, category_id, target_amount)
select 2027, c.id, v.amt
from (values
  ('個人年金',   168000),
  ('自社株',     360000),
  ('投資信託',   120000),
  ('銀行預金',  2216000)  -- 118,000×12 ＋ ボーナス400,000 ＋ 還付金400,000
) as v(nm, amt)
join categories c on c.name = v.nm;

-- ---------- merchant_rules（現行GASの guessCategory から移植）----------
insert into merchant_rules (pattern, category_id, priority)
select v.pat, c.id, 0
from (values
  ('HAMAZUSHI',  '外食'),
  ('SUSHIRO',    '外食'),
  ('MCDONALD',   '外食'),
  ('YAKINIKU',   '外食'),
  ('SEVEN',      '食費'),
  ('LAWSON',     '食費'),
  ('FAMILYMART', '食費'),
  ('LIFE CORPORA', '食費'),
  ('DEMAECAN',   '出前'),
  ('ROCKET NOW', '出前'),
  ('SUGI PHARMA', '日用品'),
  ('AMAZON',     '娯楽・買い物'),
  ('STEAMGAMES', '娯楽・買い物'),
  ('Nintendo',   '娯楽・買い物'),
  ('ENEOS',      '交通費（りほ）')
) as v(pat, cat)
join categories c on c.name = v.cat;

-- ---------- settings ----------
insert into settings (key, value) values
  ('app_name',              '家計簿'),
  ('sim_annual_return',     '3'),      -- 複利シミュレーションの想定利回り(%)
  ('sim_years',             '10'),
  ('unclassified_threshold','5'),      -- 未分類がこの件数以上でLINE通知
  ('start_month',           '2026-10-01');

-- ---------- 運用開始月の固定収支を計上 ----------
select fn_generate_fixed(date '2026-10-01');
