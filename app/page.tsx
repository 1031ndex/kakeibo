'use client';

import { useEffect, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import Login from '@/components/Login';
import Home from '@/components/Home';
import Inbox from '@/components/Inbox';
import Ledger from '@/components/Ledger';
import { fetchUnclassified } from '@/lib/db';

type Tab = 'home' | 'inbox' | 'ledger';

export default function Page() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('home');
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
    fetchUnclassified()
      .then((rows) => setPending(rows.length))
      .catch(() => setPending(0));
  }, [session]);

  useEffect(() => { refreshPending(); }, [refreshPending, tab]);

  if (!ready) return <div className="empty">読み込み中</div>;
  if (!session) return <Login />;

  return (
    <>
      <div className="app">
        {tab === 'home' && <Home onGoInbox={() => setTab('inbox')} pending={pending} />}
        {tab === 'inbox' && <Inbox onDone={refreshPending} />}
        {tab === 'ledger' && <Ledger />}
      </div>

      <nav className="tabbar">
        <button data-on={tab === 'home'} onClick={() => setTab('home')}>
          <span className="tab-mark" />ホーム
        </button>
        <button data-on={tab === 'inbox'} onClick={() => setTab('inbox')}>
          <span className="tab-mark" />未分類
          {pending > 0 && <span className="tab-badge num">{pending}</span>}
        </button>
        <button data-on={tab === 'ledger'} onClick={() => setTab('ledger')}>
          <span className="tab-mark" />明細
        </button>
      </nav>
    </>
  );
}
