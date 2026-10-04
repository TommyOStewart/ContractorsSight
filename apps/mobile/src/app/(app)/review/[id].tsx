import type { ValidationIssue } from '@contractorsight/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { supabase } from '../../../lib/supabase';
import { worker, WorkerError } from '../../../lib/worker';
import { addTempNames, describeOperation, referencedIds, type Described, type Names } from '../../../review/describe';
import { Body, Button, Card, colors, Heading, Message, Screen, Small } from '../../../ui';

interface Loaded {
  status: string;
  captureText: string;
  items: Described[];
  issues: ValidationIssue[];
}

async function loadNames(operations: { tool: string; args: Record<string, unknown> }[]): Promise<Names> {
  const ids = referencedIds(operations);
  const names: Names = { job: new Map(), client: new Map(), material: new Map(), supplyHouse: new Map(), site: new Map() };
  const list = (s: Set<string>) => [...s];

  const [jobs, clients, materials, supplyHouses, sites] = await Promise.all([
    ids.job.size ? supabase.from('jobs').select('id, title, clients (name)').in('id', list(ids.job)) : null,
    ids.client.size ? supabase.from('clients').select('id, name').in('id', list(ids.client)) : null,
    ids.material.size ? supabase.from('material_items').select('id, description, jobs (title)').in('id', list(ids.material)) : null,
    ids.supplyHouse.size ? supabase.from('supply_houses').select('id, name').in('id', list(ids.supplyHouse)) : null,
    ids.site.size ? supabase.from('sites').select('id, line1, label').in('id', list(ids.site)) : null,
  ]);
  for (const j of jobs?.data ?? []) names.job.set(j.id, `“${j.title}” (${j.clients?.name ?? 'unknown client'})`);
  for (const c of clients?.data ?? []) names.client.set(c.id, c.name);
  for (const m of materials?.data ?? []) names.material.set(m.id, `${m.description} on “${m.jobs?.title ?? 'a job'}”`);
  for (const s of supplyHouses?.data ?? []) names.supplyHouse.set(s.id, s.name);
  for (const s of sites?.data ?? []) names.site.set(s.id, s.label ? `${s.label} (${s.line1})` : s.line1);
  addTempNames(operations as { tool: string; args: Record<string, any> }[], names); // eslint-disable-line @typescript-eslint/no-explicit-any
  return names;
}

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('change_sets')
        .select('status, operations, validation_issues, captures (raw_text)')
        .eq('id', id)
        .single();
      if (error || !data) {
        setLoadError('Could not load these changes.');
        return;
      }
      const operations = (data.operations ?? []) as { tool: string; args: Record<string, any> }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
      const names = await loadNames(operations);
      setLoaded({
        status: data.status,
        captureText: data.captures?.raw_text ?? '',
        items: operations.map((op) => describeOperation(op.tool, op.args, names)),
        issues: (data.validation_issues ?? []) as unknown as ValidationIssue[],
      });
    })();
  }, [id]);

  async function act(kind: 'approve' | 'reject') {
    setError(null);
    setIssues([]);
    setBusy(kind);
    try {
      if (kind === 'approve') await worker.approve(id);
      else await worker.reject(id);
      router.back();
    } catch (e) {
      if (e instanceof WorkerError) {
        setError(e.message);
        setIssues(e.issues);
      } else setError('Something went wrong. Nothing was saved.');
    } finally {
      setBusy(null);
    }
  }

  if (loadError) return <Screen><Message text={loadError} tone="error" /></Screen>;
  if (!loaded) return <Screen><ActivityIndicator color={colors.primary} /></Screen>;

  const questions = loaded.items.filter((i) => i.isQuestion);
  const changes = loaded.items.filter((i) => !i.isQuestion);
  const shownIssues = issues.length ? issues : loaded.issues;

  return (
    <Screen align="top">
      <Small>Your note</Small>
      <Card>
        <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>{loaded.captureText}</Text>
      </Card>

      {questions.length > 0 && <Heading>Needs your answer</Heading>}
      {questions.map((q, i) => (
        <Card key={`q${i}`} tone="question">
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{q.title}</Text>
          {q.details.map((d, j) => <Small key={j}>{d}</Small>)}
        </Card>
      ))}

      <Heading>Proposed changes</Heading>
      {changes.length === 0 && <Small>No changes, only the question above.</Small>}
      {changes.map((c, i) => (
        <Card key={`c${i}`}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{c.title}</Text>
          {c.details.map((d, j) => <Small key={j}>{d}</Small>)}
        </Card>
      ))}

      {shownIssues.length > 0 && (
        <Card tone="warning">
          <Text style={{ color: colors.danger, fontWeight: '600' }}>These changes can't be saved as they are:</Text>
          {shownIssues.map((iss, i) => <Small key={i}>• {iss.message}</Small>)}
        </Card>
      )}
      <Message text={error} tone="error" />

      {loaded.status === 'pending' ? (
        <>
          <Button title="Approve all" onPress={() => act('approve')} busy={busy === 'approve'} />
          <Button variant="link" title="Reject" onPress={() => act('reject')} busy={busy === 'reject'} />
          <Small>Nothing is saved until you approve. Answering questions comes in a later version; for now, reject and send a clearer note.</Small>
        </>
      ) : (
        <Body muted>Already {loaded.status}.</Body>
      )}
    </Screen>
  );
}
