/**
 * りそなデビット利用メール → Supabase 取込
 * 家計簿アプリ v1.2
 *
 * 【初回セットアップ】
 *  1. Apps Script の「プロジェクトの設定」→「スクリプト プロパティ」に以下を登録
 *       SUPABASE_URL      https://xxxxxxxx.supabase.co
 *       SUPABASE_KEY      service_role キー
 *       ERROR_MAIL_TO     エラー通知先メールアドレス
 *  2. setup() を一度だけ実行（Gmailラベルと時間トリガーを作成）
 *  3. 以後 importResona() が1時間ごとに自動実行される
 *
 * 【旧版からの変更点】
 *  - スプレッドシートではなく Supabase に登録する
 *  - 返金・取消メール（件名「入金取引のご連絡」）に対応。マイナス金額で登録する
 *    ※ 旧版は「ご利用金額」しか見ておらず、返金を無言で捨てていた
 *  - 重複排除キーを承認番号から Gmail メッセージ ID に変更
 *    ※ 承認番号は6桁しかなく、いずれ衝突して正常な明細が欠落する
 *  - 検索窓（newer_than:30d）をやめ、処理済みラベル方式にした
 *    ※ トリガーが長期間止まっても取りこぼさない
 *  - カテゴリ推定のハードコードを廃止し、merchant_rules テーブルを参照する
 *    ※ アプリ画面からルールを育てられる
 *  - パース失敗を import_errors に記録し、メールで通知する
 */

// ===== 設定 =====
const LABEL_DONE   = '家計簿/取込済';
const SENDER       = 'debit.resonabank.co.jp';
const ACCOUNT_RESONA = 1;  // accounts.id = 1（共通りそな）
const BATCH_SIZE   = 50;

// ===== 初回セットアップ =====
function setup() {
  if (!GmailApp.getUserLabelByName(LABEL_DONE)) {
    GmailApp.createLabel(LABEL_DONE);
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importResona') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importResona').timeBased().everyHours(1).create();
  Logger.log('セットアップ完了');
}

// ===== メイン =====
function importResona() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY が未設定です');

  const label = GmailApp.getUserLabelByName(LABEL_DONE);
  if (!label) throw new Error('先に setup() を実行してください');

  // アプリの設定タブで取込を止められる
  const conf = fetchSettings_(url, key);
  if (conf.import_enabled === 'false') {
    Logger.log('取込は設定でオフになっています');
    return;
  }
  const importFrom = conf.import_from || '1970-01-01';

  const rules = fetchRules_(url, key);
  const threads = GmailApp.search(
    'from:(' + SENDER + ') -label:"' + LABEL_DONE + '"', 0, BATCH_SIZE);

  const rows = [];
  const errors = [];
  const doneThreads = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      const subject = msg.getSubject() || '';
      const body = msg.getPlainBody() || '';
      const isRefund = /入金取引/.test(subject);
      const parsed = parseMail_(body, msg.getDate(), isRefund);

      // 運用開始前のメールは取り込まない
      if (parsed && parsed.occurredOn < importFrom) {
        thread.addLabel(label);
        return;
      }

      if (!parsed) {
        errors.push({
          gmail_message_id: msg.getId(),
          subject: subject,
          reason: '金額または承認番号を読み取れませんでした',
          raw_excerpt: body.slice(0, 500)
        });
        return;
      }

      rows.push({
        occurred_on: parsed.occurredOn,
        account_id: ACCOUNT_RESONA,
        type: '支出',
        category_id: matchCategory_(parsed.store, rules),
        merchant: parsed.store,
        amount: isRefund ? -parsed.amount : parsed.amount,
        payer: '共通',
        gmail_message_id: msg.getId(),
        approval_no: parsed.approvalNo,
        is_refund: isRefund,
        source: 'auto'
      });
    });
    doneThreads.push(thread);
  });

  if (rows.length) postRows_(url, key, 'transactions', rows);
  if (errors.length) {
    postRows_(url, key, 'import_errors', errors);
    notifyErrors_(errors);
  }
  // 登録が成功した場合のみラベルを付ける（失敗時は次回リトライされる）
  doneThreads.forEach(function (t) { t.addLabel(label); });

  Logger.log('取込 ' + rows.length + '件 / エラー ' + errors.length + '件');
}

// ===== メール本文の解析 =====
// 通常利用: ご利用日時 / ご利用金額 / 承認番号 / ご利用加盟店名
// 返金取消: ご入金金額 / 承認番号 / ご利用加盟店名（日時の記載なし）
function parseMail_(body, receivedAt, isRefund) {
  const amountM   = body.match(/ご(?:利用|入金)金額[：:]\s*([\d,]+)\s*円/);
  const approvalM = body.match(/承認番号[：:]\s*(\d+)/);
  if (!amountM || !approvalM) return null;

  const dateM  = body.match(/ご利用日時[：:]\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})\s+(\d{1,2}:\d{2})/);
  const storeM = body.match(/ご利用加盟店名[^：:]*[：:]\s*(.+)/);

  let occurredOn;
  if (dateM && !isRefund) {
    occurredOn = dateM[1].replace(/\//g, '-').replace(/-(\d)(?!\d)/g, '-0$1');
  } else {
    // 返金メールには日時がないため受信日を使う
    occurredOn = Utilities.formatDate(receivedAt, 'Asia/Tokyo', 'yyyy-MM-dd');
  }

  return {
    occurredOn: occurredOn,
    amount: Number(amountM[1].replace(/,/g, '')),
    approvalNo: approvalM[1].trim(),
    store: storeM ? storeM[1].trim() : ''
  };
}

// ===== 設定の取得 =====
function fetchSettings_(url, key) {
  const res = UrlFetchApp.fetch(url + '/rest/v1/settings?select=key,value', {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) return {};
  const out = {};
  JSON.parse(res.getContentText()).forEach(function (r) { out[r.key] = r.value; });
  return out;
}

// ===== カテゴリ推定 =====
function fetchRules_(url, key) {
  const res = UrlFetchApp.fetch(
    url + '/rest/v1/merchant_rules?select=pattern,category_id,priority',
    { headers: { apikey: key, Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return [];
  const rules = JSON.parse(res.getContentText());
  // 優先度が高い順、次に pattern が長い順（より具体的なルールを優先）
  rules.sort(function (a, b) {
    return (b.priority - a.priority) || (b.pattern.length - a.pattern.length);
  });
  return rules;
}

function matchCategory_(store, rules) {
  const s = (store || '').toUpperCase();
  for (var i = 0; i < rules.length; i++) {
    if (s.indexOf(rules[i].pattern.toUpperCase()) >= 0) return rules[i].category_id;
  }
  return null;   // 未分類。アプリの振り分け画面で処理する
}

// ===== Supabase へ登録 =====
function postRows_(url, key, table, rows) {
  const res = UrlFetchApp.fetch(url + '/rest/v1/' + table, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      // gmail_message_id の UNIQUE 制約に当たった行は黙って無視される
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 300) {
    throw new Error(table + ' の登録に失敗 (' + code + '): ' + res.getContentText());
  }
}

// ===== エラー通知 =====
function notifyErrors_(errors) {
  const to = PropertiesService.getScriptProperties().getProperty('ERROR_MAIL_TO');
  if (!to) return;
  const lines = errors.map(function (e) {
    return '件名: ' + e.subject + '\n理由: ' + e.reason;
  }).join('\n\n');
  MailApp.sendEmail(to, '[家計簿] 取込エラー ' + errors.length + '件',
    'りそなメールの解析に失敗しました。メールの書式が変わった可能性があります。\n\n' + lines);
}

// ===== 動作確認用（1件だけ解析してログに出す。登録はしない）=====
function dryRun() {
  const threads = GmailApp.search('from:(' + SENDER + ')', 0, 3);
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      const isRefund = /入金取引/.test(m.getSubject() || '');
      Logger.log(m.getSubject());
      Logger.log(JSON.stringify(parseMail_(m.getPlainBody(), m.getDate(), isRefund)));
    });
  });
}
