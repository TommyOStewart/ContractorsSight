import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { supabase } from '../lib/supabase';

export interface PendingItem {
  id: string;
  createdAt: string;
  text: string;
  captureType: string;
  /** Changes, not counting questions. */
  changeCount: number;
  questionCount: number;
}

/** A recent capture the worker is still on, or that failed (so a note sent before leaving the app isn't lost silently). */
export interface InFlightItem {
  id: string;
  createdAt: string;
  captureType: string;
  status: 'processing' | 'failed';
  error: string | null;
}

interface PendingState {
  items: PendingItem[];
  inFlight: InFlightItem[];
  refresh(): Promise<void>;
}

const PendingContext = createContext<PendingState | null>(null);

export function usePending(): PendingState {
  const value = use(PendingContext);
  if (!value) throw new Error('usePending must be used inside <PendingProvider>');
  return value;
}

/** Notes waiting for review, shared by the home banner, the Review tab, and its badge. */
export function PendingProvider({ children }: { children: ReactNode }) {
  const { memberships } = useSession();
  const orgId = memberships[0]?.orgId;
  const [items, setItems] = useState<PendingItem[]>([]);
  const [inFlight, setInFlight] = useState<InFlightItem[]>([]);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    const [{ data }, { data: recent }] = await Promise.all([
      supabase
        .from('change_sets')
        .select('id, created_at, operations, captures (raw_text, type)')
        .eq('org_id', orgId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50),
      // Older "processing" rows are worker restarts that will never finish; don't show them forever.
      supabase
        .from('captures')
        .select('id, created_at, type, status, error')
        .eq('org_id', orgId)
        .in('status', ['processing', 'failed'])
        .gte('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10),
    ]);
    setInFlight(
      (recent ?? []).map((c) => ({ id: c.id, createdAt: c.created_at, captureType: c.type, status: c.status as InFlightItem['status'], error: c.error })),
    );
    setItems(
      (data ?? []).map((row) => {
        const ops = (Array.isArray(row.operations) ? row.operations : []) as { tool?: string }[];
        const questions = ops.filter((o) => o.tool === 'flag_ambiguity').length;
        return {
          id: row.id,
          createdAt: row.created_at,
          text: row.captures?.raw_text ?? '',
          captureType: row.captures?.type ?? 'text',
          changeCount: ops.length - questions,
          questionCount: questions,
        };
      }),
    );
  }, [orgId]);

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // While the worker is on something, check back every few seconds so the result shows up by itself.
  const working = inFlight.some((c) => c.status === 'processing');
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, 4000);
    return () => clearInterval(timer);
  }, [working, refresh]);

  return <PendingContext value={{ items, inFlight, refresh }}>{children}</PendingContext>;
}
