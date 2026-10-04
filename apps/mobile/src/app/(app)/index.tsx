import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { supabase } from '../../lib/supabase';
import { worker, WorkerError } from '../../lib/worker';
import { Body, Button, Card, colors, Field, Heading, Message, Screen, Small, Title } from '../../ui';

interface Pending {
  id: string;
  createdAt: string;
  text: string;
  operationCount: number;
}

export default function HomeScreen() {
  const { session, memberships, signOut } = useSession();
  const company = memberships[0]!;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);

  const loadPending = useCallback(async () => {
    const { data } = await supabase
      .from('change_sets')
      .select('id, created_at, operations, captures (raw_text)')
      .eq('org_id', company.orgId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(20);
    setPending(
      (data ?? []).map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        text: row.captures?.raw_text ?? '',
        operationCount: Array.isArray(row.operations) ? row.operations.length : 0,
      })),
    );
  }, [company.orgId]);

  useFocusEffect(
    useCallback(() => {
      void loadPending();
    }, [loadPending]),
  );

  async function send() {
    setError(null);
    setNotice(null);
    if (!text.trim()) return;
    setBusy(true);
    try {
      const result = await worker.createCapture({ orgId: company.orgId, text: text.trim() });
      setText('');
      if (result.changeSetId) router.push(`/review/${result.changeSetId}`);
      else setNotice(result.summary ?? 'Nothing to record in that note.');
    } catch (e) {
      setError(e instanceof WorkerError ? e.message : 'Something went wrong sending that note.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen align="top">
      <Title>{company.orgName}</Title>
      <Small>
        Signed in as {session?.user.email} ({company.role})
      </Small>

      <Field
        label="What happened?"
        value={text}
        onChangeText={setText}
        multiline
        placeholder={"e.g. Henderson okayed the water heater quote. Need 2 SB couplings for Maria's repipe."}
      />
      <Button title="Send" onPress={send} busy={busy} />
      {busy && <Small>Reading your note… this takes a few seconds.</Small>}
      <Message text={error} tone="error" />
      <Message text={notice} tone="success" />

      <Heading>Waiting for review</Heading>
      {pending.length === 0 ? (
        <Small>Nothing waiting.</Small>
      ) : (
        pending.map((p) => (
          <Card key={p.id} onPress={() => router.push(`/review/${p.id}`)}>
            <Text style={{ color: colors.text, fontSize: 15 }} numberOfLines={2}>
              {p.text}
            </Text>
            <Small>
              {p.operationCount} proposed change{p.operationCount === 1 ? '' : 's'} · {new Date(p.createdAt).toLocaleString()}
            </Small>
          </Card>
        ))
      )}

      <Button variant="link" title="Clients and jobs" onPress={() => router.push('/jobs')} />
      <Body muted> </Body>
      <Button variant="link" title="Sign out" onPress={signOut} />
    </Screen>
  );
}
