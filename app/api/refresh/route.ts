import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 更新ボタンの受け口。
 *
 * ブラウザから Apps Script を直接叩くと CORS で弾かれるうえ、合言葉がブラウザに置かれてしまう。
 * そこでサーバー側で中継し、URLと合言葉は環境変数に閉じ込める。
 * また、ログインしている人からの要求だけを受け付ける。
 */
export async function POST(req: Request) {
  // ログイン確認
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) {
    return NextResponse.json({ ok: false, error: 'ログインし直してください' }, { status: 401 });
  }
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: who, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !who?.user) {
    return NextResponse.json({ ok: false, error: 'ログインし直してください' }, { status: 401 });
  }

  const url = process.env.GAS_REFRESH_URL;
  const secret = process.env.GAS_REFRESH_TOKEN;
  if (!url || !secret) {
    return NextResponse.json(
      { ok: false, error: '更新用の設定がされていません（Vercelの環境変数）' },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(`${url}?token=${encodeURIComponent(secret)}`, {
      redirect: 'follow',
      cache: 'no-store',
    });
    const text = await res.text();

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      // Apps Script がHTMLのエラーページを返した場合（デプロイ設定の誤りなど）
      return NextResponse.json(
        { ok: false, error: '取込スクリプトから正しい応答がありません' },
        { status: 502 },
      );
    }

    if (!data.ok) {
      const msg = data.error === 'unauthorized'
        ? '合言葉が一致しません'
        : (data.error ?? '取込に失敗しました');
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    return NextResponse.json({ ok: true, imported: data.imported ?? 0, errors: data.errors ?? 0 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? '取込スクリプトに接続できません' },
      { status: 502 },
    );
  }
}
