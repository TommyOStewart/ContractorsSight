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

interface PendingState {
  items: PendingItem[];
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

  const refresh = useCallback(async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('change_sets')
      .select('id, created_at, operations, captures (raw_text, type)')
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);
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

  return <PendingContext value={{ items, refresh }}>{children}</PendingContext>;
}
