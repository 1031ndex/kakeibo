/**
 * りそなデビット利用メール → Supabase 取込
 * 家計簿アプリ v3.3（LINE通知つき）
 *
 * 【セットアップ】
 *  1. 「プロジェクトの設定」→「スクリプト プロパティ」に登録
 *       SUPABASE_URL        https://xxxxxxxx.supabase.co  （末尾に /rest/v1/ を付けない）
 *       SUPABASE_KEY        Secret key（sb_secret_... で始まるもの）
 *       ERROR_MAIL_TO       エラー通知先メールアドレス
 *       REFRESH_TOKEN       アプリの更新ボタン用の合言葉（自分で決めた文字列）
 *       LINE_CHANNEL_TOKEN  LINEのチャネルアクセストークン（長期）。通知を使うときだけ
 *     LINE_GROUP_ID は自動で入る（グループで「家計簿を登録」と送ったとき）
 *  2. setup() を一度実行（1時間ごとの自動実行を登録）
 *  3. importResona() を一度実行（取りこぼしていた分をまとめて取り込む）
 *  4. 「デプロイ」→「新しいデプロイ」→ 種類「ウェブアプリ」
 *       次のユーザーとして実行: 自分
 *       アクセスできるユーザー: 全員
 *     出てきた /exec のURLを、Vercel の環境変数 GAS_REFRESH_URL に登録する。
 *     「全員」にするのは Vercel から呼ぶため。合言葉が一致しない要求は何もしない。
 *
 *  5. LINE Developers の Messaging API 設定で、Webhook URL に同じ /exec のURLを入れ、
 *     「Webhookの利用」をオンにする。グループで「家計簿を登録」と送るとグループが登録される。
 *     testLine() を実行してテストの通知が届けば完了。
 *
 *  ※ あとでこのコードを書き換えたときは「デプロイを管理」→ 鉛筆 →
 *     バージョン「新バージョン」→ デプロイ。URLは変わらない。
 *
 * 【仕組み】
 *  ・取り込んだかどうかは、Supabase に登録済みの Gmail メッセージID で判定する。
 *    りそなは件名が毎回同じなので Gmail が複数の通知を1つのスレッドにまとめる。
 *    スレッド単位で判定すると、同じスレッドに後から届いた通知を取りこぼす。
 *  ・取り込む件名は次の2つだけ。
 *      取り込む    : ご利用およびご利用代金引落しのご連絡
 *      取り込む    : 入金取引のご連絡（返品・取消。マイナス金額で登録）
 *      取り込まない: お取引不能のご連絡 / 利用限度額変更通知 / その他の案内
 *    「お取引不能」は決済が成立していないのに「ご利用金額」が書かれているため、
 *    条件を緩めると使っていない金額が支出として入ってしまう。
 *  ・読み取れなかったメールは1回だけ通知する（毎時同じエラーが届かないように）。
 *  ・1時間ごとの自動実行と更新ボタンが同時に動いても二重にならないよう、ロックをかける。
 *  ・取込のあとに通知の条件を調べ、新しい通知があればLINEのグループに送る。
 *    同じ通知は1つの期間（25日〜翌月24日）に1回だけ。夜23時〜朝7時は朝にまとめて送る（設定で変更可）。
 */

// ===== 設定 =====
const SENDER         = 'debit.resonabank.co.jp';
const ACCOUNT_RESONA = 1;      // accounts.id = 1（共通りそな）
const SEARCH_DAYS    = 60;     // 何日前まで遡って探すか
const MAX_THREADS    = 100;
const TARGET_SUBJECT = /ご利用代金引落し|入金取引/;
const REFUND_SUBJECT = /入金取引/;

// ===== セットアップ =====
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'importResona') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('importResona').timeBased().everyHours(1).create();
  Logger.log('セットアップ完了：1時間ごとに importResona が動きます');
}

// ===== アプリの更新ボタンから呼ばれる入口 =====
function doGet(e) {
  const want = PropertiesService.getScriptProperties().getProperty('REFRESH_TOKEN');
  const got = (e && e.parameter && e.parameter.token) || '';
  if (!want || got !== want) return json_({ ok: false, error: 'unauthorized' });
  try {
    const r = importResona();
    return json_({ ok: true, imported: r.imported, errors: r.errors });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== メイン =====
function importResona() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('別の取込が実行中のため終了');
    return { imported: 0, errors: 0 };
  }
  try {
    const r = importResona_();
    // 通知は取込とは別に失敗しても、取込の結果は返す
    try { runAlerts_(); } catch (e) { Logger.log('通知でエラー: ' + e); }
    return r;
  } finally {
    lock.releaseLock();
  }
}

function importResona_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_KEY が未設定です');

  // アプリの設定タブで取込を止められる
  const conf = fetchSettings_(url, key);
  if (conf.import_enabled === 'false') {
    Logger.log('取込は設定でオフになっています');
    return { imported: 0, errors: 0 };
  }
  const importFrom = conf.import_from || '1970-01-01';

  const rules = fetchRules_(url, key);
  const known = fetchKnownIds_(url, key);   // 登録済み・エラー記録済みのメッセージID

  const threads = GmailApp.search(
    'from:(' + SENDER + ') newer_than:' + SEARCH_DAYS + 'd', 0, MAX_THREADS);

  const rows = [];
  const errors = [];

  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      const id = msg.getId();
      if (known[id]) return;

      const subject = msg.getSubject() || '';
      if (!TARGET_SUBJECT.test(subject)) return;

      const isRefund = REFUND_SUBJECT.test(subject);
      const body = msg.getPlainBody() || '';
      const parsed = parseMail_(body, msg.getDate(), isRefund);

      if (!parsed) {
        errors.push({
          gmail_message_id: id,
          subject: subject,
          reason: '金額または承認番号を読み取れませんでした',
          raw_excerpt: body.slice(0, 500)
        });
        return;
      }

      // 運用開始前のメールは取り込まない
      if (parsed.occurredOn < importFrom) return;

      rows.push({
        occurred_on: parsed.occurredOn,
        account_id: ACCOUNT_RESONA,
        type: '支出',
        category_id: matchCategory_(parsed.store, rules),
        merchant: parsed.store,
        amount: isRefund ? -parsed.amount : parsed.amount,
        payer: '共通',
        gmail_message_id: id,
        approval_no: parsed.approvalNo,
        is_refund: isRefund,
        source: 'auto'
      });
    });
  });

  if (rows.length) postRows_(url, key, 'transactions?on_conflict=gmail_message_id', rows, true);
  if (errors.length) {
    postRows_(url, key, 'import_errors', errors, false);
    notifyErrors_(errors);
  }

  Logger.log('取込 ' + rows.length + '件 / エラー ' + errors.length + '件');
  return { imported: rows.length, errors: errors.length };
}

// ===== 通知 =====
function runAlerts_() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_KEY');

  // 条件を調べて、新しく満たしたものを alerts に入れる（アプリ内にはこれで出る）
  rpc_(url, key, 'fn_check_alerts', {});

  const conf = fetchSettings_(url, key);
  const token = props.getProperty('LINE_CHANNEL_TOKEN');
  const group = props.getProperty('LINE_GROUP_ID');
  if (conf.line_enabled === 'false' || !token || !group) return;

  // 夜は送らず、朝7時以降の最初の実行でまとめて送る
  const hour = Number(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'H'));
  if (conf.alert_quiet_night !== 'false' && (hour >= 23 || hour < 7)) return;

  const pending = getJson_(url, key, 'alerts?select=id,title,body,created_at&sent_at=is.null&order=id');
  if (!pending.length) return;

  // 24時間より前の通知は今さら送らない（LINEを設定する前にたまっていた分など）
  const limit = Date.now() - 24 * 3600 * 1000;
  const fresh = pending.filter(function (a) { return new Date(a.created_at).getTime() >= limit; });
  const stale = pending.filter(function (a) { return new Date(a.created_at).getTime() < limit; });
  if (stale.length) markSent_(url, key, stale.map(function (a) { return a.id; }));

  // LINEは1回に5件まで
  for (var i = 0; i < fresh.length; i += 5) {
    const chunk = fresh.slice(i, i + 5);
    linePush_(token, group, chunk.map(function (a) {
      return '【家計簿】' + a.title + '\n' + a.body;
    }));
    markSent_(url, key, chunk.map(function (a) { return a.id; }));
  }
  Logger.log('LINEに ' + fresh.length + ' 件送りました');
}

function linePush_(token, to, texts) {
  const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({
      to: to,
      messages: texts.map(function (t) { return { type: 'text', text: t.slice(0, 4900) }; })
    }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('LINEへの送信に失敗 (' + res.getResponseCode() + '): ' + res.getContentText());
  }
}

function lineReply_(replyToken, text) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN');
  if (!token || !replyToken) return;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
    muteHttpExceptions: true
  });
}

function markSent_(url, key, ids) {
  if (!ids.length) return;
  const res = UrlFetchApp.fetch(url + '/rest/v1/alerts?id=in.(' + ids.join(',') + ')', {
    method: 'patch',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
    payload: JSON.stringify({ sent_at: new Date().toISOString() }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error('送信済みにできません: ' + res.getContentText());
}

// ===== LINEのWebhook（グループの登録）=====
// グループで「家計簿を登録」と送ると、そのグループを通知先にする。
// 誰でも呼べるURLなので、登録できるのは「まだ登録されていないとき」だけにしてある。
function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const props = PropertiesService.getScriptProperties();
    (data.events || []).forEach(function (ev) {
      const src = ev.source || {};
      if (src.type !== 'group') return;
      const text = (ev.type === 'message' && ev.message && ev.message.type === 'text')
        ? String(ev.message.text).trim() : '';
      if (text !== '家計簿を登録') return;

      const current = props.getProperty('LINE_GROUP_ID');
      if (current && current !== src.groupId) {
        lineReply_(ev.replyToken, 'すでに別のグループが登録されています。');
        return;
      }
      props.setProperty('LINE_GROUP_ID', src.groupId);
      setSetting_('line_group', 'registered');
      lineReply_(ev.replyToken, 'このグループに家計簿の通知を送ります。');
    });
  } catch (err) {
    Logger.log('Webhookの処理でエラー: ' + err);
  }
  return ContentService.createTextOutput('ok');
}

// ===== 動作確認用 =====
// テストの通知をLINEのグループに送る
function testLine() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('LINE_CHANNEL_TOKEN');
  const group = props.getProperty('LINE_GROUP_ID');
  if (!token) throw new Error('LINE_CHANNEL_TOKEN が未設定です');
  if (!group) throw new Error('グループが未登録です。グループで「家計簿を登録」と送ってください');
  linePush_(token, group, ['【家計簿】テストの通知です。\nこれが届けば通知の設定は完了です。']);
  Logger.log('送りました');
}

// 通知先のグループを登録し直したいときに実行する
function resetLineGroup() {
  PropertiesService.getScriptProperties().deleteProperty('LINE_GROUP_ID');
  setSetting_('line_group', '');
  Logger.log('グループの登録を消しました。グループで「家計簿を登録」と送り直してください');
}

// ===== Supabase の小さな道具 =====
function rpc_(url, key, fn, args) {
  const res = UrlFetchApp.fetch(url + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    payload: JSON.stringify(args || {}),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) throw new Error(fn + ' に失敗 (' + res.getResponseCode() + '): ' + res.getContentText());
  return res.getContentText();
}

function getJson_(url, key, path) {
  const res = UrlFetchApp.fetch(url + '/rest/v1/' + path, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error(path + ' を読めません (' + res.getResponseCode() + ')');
  return JSON.parse(res.getContentText());
}

function setSetting_(k, v) {
  const props = PropertiesService.getScriptProperties();
  rpc_(props.getProperty('SUPABASE_URL'), props.getProperty('SUPABASE_KEY'), 'fn_set_setting', { k: k, v: v });
}

// ===== 取り込み済みのメッセージID =====
// 明細として登録済みのものと、エラーとして記録済みのもの。
// 後者を含めないと、読めないメールについて毎時同じエラー通知が届いてしまう。
function fetchKnownIds_(url, key) {
  const since = Utilities.formatDate(
    new Date(Date.now() - (SEARCH_DAYS + 15) * 24 * 3600 * 1000), 'Asia/Tokyo', 'yyyy-MM-dd');
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  const out = {};

  [
    url + '/rest/v1/transactions?select=gmail_message_id&gmail_message_id=not.is.null&created_at=gte.' + since,
    url + '/rest/v1/import_errors?select=gmail_message_id&gmail_message_id=not.is.null&created_at=gte.' + since
  ].forEach(function (u) {
    const res = UrlFetchApp.fetch(u, { headers: headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('登録済みの明細を読めませんでした (' + res.getResponseCode() + '): ' + res.getContentText());
    }
    JSON.parse(res.getContentText()).forEach(function (r) { out[r.gmail_message_id] = true; });
  });
  return out;
}

// ===== メール本文の解析 =====
// 通常利用: ご利用日時 / ご利用金額 / 承認番号 / ご利用加盟店名
// 返金取消: ご入金金額 / 承認番号 / ご利用加盟店名（日時の記載なし）
function parseMail_(body, receivedAt, isRefund) {
  const amountM   = body.match(/ご(?:利用|入金)金額[：:]\s*([\d,]+)\s*円/);
  const approvalM = body.match(/承認番号[：:]\s*(\d+)/);
  if (!amountM || !approvalM) return null;

  const dateM  = body.match(/ご利用日時[：:]\s*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/);
  const storeM = body.match(/ご利用加盟店名[^：:]*[：:]\s*(.+)/);

  let occurredOn;
  if (dateM && !isRefund) {
    const p = dateM[1].split(/[\/\-]/);
    occurredOn = p[0] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[2]).slice(-2);
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
  if (res.getResponseCode() !== 200) {
    throw new Error('Supabase に接続できません (' + res.getResponseCode() + ')。一時停止していないか確認してください');
  }
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
function postRows_(url, key, path, rows, ignoreDuplicates) {
  const headers = { apikey: key, Authorization: 'Bearer ' + key };
  // 同じメッセージIDがすでにあれば黙って飛ばす（二重登録しない）
  headers.Prefer = ignoreDuplicates ? 'resolution=ignore-duplicates,return=minimal' : 'return=minimal';
  const res = UrlFetchApp.fetch(url + '/rest/v1/' + path, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 300) throw new Error(path + ' の登録に失敗 (' + code + '): ' + res.getContentText());
}

// ===== エラー通知 =====
function notifyErrors_(errors) {
  const to = PropertiesService.getScriptProperties().getProperty('ERROR_MAIL_TO');
  if (!to) return;
  const lines = errors.map(function (e) {
    return '件名: ' + e.subject + '\n理由: ' + e.reason;
  }).join('\n\n');
  MailApp.sendEmail(to, '[家計簿] 取込エラー ' + errors.length + '件',
    'りそなメールの読み取りに失敗しました。メールの書式が変わった可能性があります。\n' +
    '同じメールについての通知はこれが最後です。\n\n' + lines);
}

// ===== 動作確認用（解析結果をログに出すだけ。登録はしない）=====
function dryRun() {
  const threads = GmailApp.search('from:(' + SENDER + ') newer_than:14d', 0, 20);
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      const subject = m.getSubject() || '';
      if (!TARGET_SUBJECT.test(subject)) {
        Logger.log('[対象外] ' + subject);
        return;
      }
      Logger.log(JSON.stringify(parseMail_(m.getPlainBody(), m.getDate(), REFUND_SUBJECT.test(subject))));
    });
  });
}

// ===== 取りこぼし確認用 =====
// Gmail にあるのに Supabase に入っていないメールを一覧にする
function checkMissing() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_KEY');
  const importFrom = fetchSettings_(url, key).import_from || '1970-01-01';
  const known = fetchKnownIds_(url, key);

  const threads = GmailApp.search('from:(' + SENDER + ') newer_than:' + SEARCH_DAYS + 'd', 0, MAX_THREADS);
  var missing = 0;
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      const subject = m.getSubject() || '';
      if (!TARGET_SUBJECT.test(subject) || known[m.getId()]) return;
      const p = parseMail_(m.getPlainBody(), m.getDate(), REFUND_SUBJECT.test(subject));
      if (p && p.occurredOn >= importFrom) {
        Logger.log('未登録: ' + p.occurredOn + ' ' + p.store + ' ' + p.amount + '円');
        missing++;
      }
    });
  });
  Logger.log('未登録 合計 ' + missing + '件');
}
