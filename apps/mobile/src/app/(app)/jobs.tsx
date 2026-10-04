import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { supabase } from '../../lib/supabase';
import { Card, colors, Heading, Screen, Small } from '../../ui';

interface JobRow {
  id: string;
  title: string;
  status: string;
  client: string;
  materials: number;
  scheduledStart: string | null;
}

// Read-only list so captures can be checked after approval. Editing comes later.
export default function JobsScreen() {
  const { memberships } = useSession();
  const orgId = memberships[0]!.orgId;
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string; phone: string | null }[]>([]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [j, c] = await Promise.all([
          supabase
            .from('jobs')
            .select('id, title, status, scheduled_start, clients (name), material_items (id, removed_at)')
            .eq('org_id', orgId)
            .order('updated_at', { ascending: false })
            .limit(100),
          supabase.from('clients').select('id, name, phone').eq('org_id', orgId).order('name').limit(200),
        ]);
        setJobs(
          (j.data ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            status: row.status,
            client: row.clients?.name ?? '',
            materials: (row.material_items ?? []).filter((m) => !m.removed_at).length,
            scheduledStart: row.scheduled_start,
          })),
        );
        setClients(c.data ?? []);
      })();
    }, [orgId]),
  );

  return (
    <Screen align="top">
      <Heading>Jobs</Heading>
      {jobs.length === 0 && <Small>No jobs yet.</Small>}
      {jobs.map((j) => (
        <Card key={j.id}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{j.title}</Text>
          <Small>
            {j.client} · {j.status.replace('_', ' ')}
            {j.materials ? ` · ${j.materials} material${j.materials === 1 ? '' : 's'}` : ''}
            {j.scheduledStart ? ` · ${new Date(j.scheduledStart).toLocaleString()}` : ''}
          </Small>
        </Card>
      ))}
      <Heading>Clients</Heading>
      {clients.length === 0 && <Small>No clients yet.</Small>}
      {clients.map((c) => (
        <Card key={c.id}>
          <Text style={{ color: colors.text, fontSize: 16 }}>{c.name}</Text>
          {c.phone && <Small>{c.phone}</Small>}
        </Card>
      ))}
    </Screen>
  );
}
