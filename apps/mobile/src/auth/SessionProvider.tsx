import type { OrgRole } from '@contractorsight/shared';
import type { Session } from '@supabase/supabase-js';
import { createContext, use, useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';

export interface Membership {
  orgId: string;
  orgName: string;
  role: OrgRole;
}

interface SessionState {
  session: Session | null;
  /** Companies the user belongs to. Empty means they still need to create (or be invited to) one. */
  memberships: Membership[];
  /** True until the stored session and its memberships have been read. */
  isLoading: boolean;
  refreshMemberships(): Promise<void>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const value = use(SessionContext);
  if (!value) throw new Error('useSession must be used inside <SessionProvider>');
  return value;
}

async function fetchMemberships(userId: string): Promise<Membership[]> {
  const { data, error } = await supabase
    .from('org_members')
    .select('role, organizations (id, name)')
    .eq('user_id', userId)
    .order('created_at');
  if (error) throw error;
  return data.flatMap((row) =>
    row.organizations ? [{ orgId: row.organizations.id, orgName: row.organizations.name, role: row.role }] : [],
  );
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionRead, setSessionRead] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  // The user the current `memberships` were loaded for, so a stale list is never shown for a new user.
  const [membershipsUserId, setMembershipsUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionRead(true);
    });
    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the auth client.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;

  const refreshMemberships = useCallback(async () => {
    if (!userId) return;
    try {
      setMemberships(await fetchMemberships(userId));
    } catch (error) {
      console.warn('Failed to load memberships', error);
      setMemberships([]);
    }
    setMembershipsUserId(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setMemberships([]);
      setMembershipsUserId(null);
      return;
    }
    void refreshMemberships();
  }, [userId, refreshMemberships]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const isLoading = !sessionRead || (userId !== null && membershipsUserId !== userId);

  return (
    <SessionContext value={{ session, memberships, isLoading, refreshMemberships, signOut }}>
      {children}
    </SessionContext>
  );
}
