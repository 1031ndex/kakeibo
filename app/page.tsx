'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import Login from '@/components/Login';
import Calendar from '@/components/Calendar';
import Inbox from '@/components/Inbox';
import Savings from '@/components/Savings';
import Chart from '@/components/Chart';
import Settings from '@/components/Settings';
import { fetchUnclassified } from '@/lib/db';

type Tab = 'calendar' | 'inbox' | 'savings' | 'chart' | 'settings';

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('calendar');
  const [pending, setPending] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const refreshPending = useCallback(() => {
    if (!session) return;
    fetchUnclassified().then((r) => setPending(r.length)).catch(() => setPending(0));
  }, [session]);

  useEffect(() => { refreshPending(); }, [refreshPending, tab]);

  if (!ready) return <div className="empty">読み込み中</div>;
  if (!session) return <Login />;

  return (
    <>
      <div className="app">
        {tab === 'calendar' && <Calendar />}
        {tab === 'inbox' && <Inbox onDone={refreshPending} />}
        {tab === 'savings' && <Savings />}
        {tab === 'chart' && <Chart />}
        {tab === 'settings' && <Settings />}
      </div>

      <nav className="tabbar">
        <button data-on={tab === 'calendar'} onClick={() => setTab('calendar')}>
          <span className="tab-mark" />カレンダー
        </button>
        <button data-on={tab === 'inbox'} onClick={() => setTab('inbox')}>
          <span className="tab-mark" />未分類
          {pending > 0 && <span className="tab-badge num">{pending}</span>}
        </button>
        <button data-on={tab === 'savings'} onClick={() => setTab('savings')}>
          <span className="tab-mark" />貯蓄
        </button>
        <button data-on={tab === 'chart'} onClick={() => setTab('chart')}>
          <span className="tab-mark" />グラフ
        </button>
        <button data-on={tab === 'settings'} onClick={() => setTab('settings')}>
          <span className="tab-mark" />設定
        </button>
      </nav>
    </>
  );
}
