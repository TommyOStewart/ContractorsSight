import type { ValidationIssue } from '@contractorsight/shared';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { usePending } from '../../../data/PendingProvider';
import { supabase } from '../../../lib/supabase';
import { worker, WorkerError } from '../../../lib/worker';
import { addTempNames, describeOperation, referencedIds, type Described, type Names } from '../../../review/describe';
import { OperationEditor } from '../../../review/OperationEditor';
import { BigButton, Card, CheckRow, colors, Display, fonts, IconButton, Loading, Message, Screen, SecondaryButton, SectionLabel, Small, Strong, TextButton } from '../../../ui';

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Question {
  question: string;
  excerpt?: string;
  options: string[];
}

interface Loaded {
  status: string;
  captureText: string;
  captureType: string;
  createdAt: string;
  /** Changes with their index in the stored operations (needed to approve a selection). */
  changes: { index: number; described: Described; args: Args }[];
  questions: Question[];
  issues: ValidationIssue[];
}

async function loadNames(operations: { tool: string; args: Args }[]): Promise<Names> {
  const ids = referencedIds(operations);
  const names: Names = { job: new Map(), client: new Map(), material: new Map(), supplyHouse: new Map(), site: new Map(), invoice: new Map() };
  const list = (s: Set<string>) => [...s];
  const [jobs, clients, materials, supplyHouses, sites, invoices] = await Promise.all([
    ids.job.size ? supabase.from('jobs').select('id, title, clients (name)').in('id', list(ids.job)) : null,
    ids.client.size ? supabase.from('clients').select('id, name').in('id', list(ids.client)) : null,
    ids.material.size ? supabase.from('material_items').select('id, description, jobs (title)').in('id', list(ids.material)) : null,
    ids.supplyHouse.size ? supabase.from('supply_houses').select('id, name').in('id', list(ids.supplyHouse)) : null,
    ids.site.size ? supabase.from('sites').select('id, line1, label').in('id', list(ids.site)) : null,
    ids.invoice.size ? supabase.from('invoices').select('id, number, jobs (title)').in('id', list(ids.invoice)) : null,
  ]);
  for (const j of jobs?.data ?? []) names.job.set(j.id, `${j.title} · ${j.clients?.name ?? 'unknown client'}`);
  for (const c of clients?.data ?? []) names.client.set(c.id, c.name);
  for (const m of materials?.data ?? []) names.material.set(m.id, `${m.description} (${m.jobs?.title ?? 'a job'})`);
  for (const s of supplyHouses?.data ?? []) names.supplyHouse.set(s.id, s.name);
  for (const s of sites?.data ?? []) names.site.set(s.id, s.label ? `${s.label} (${s.line1})` : s.line1);
  for (const i of invoices?.data ?? []) names.invoice.set(i.id, `Invoice #${i.number} · ${i.jobs?.title ?? 'a job'}`);
  addTempNames(operations, names);
  return names;
}

export default function ReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { refresh } = usePending();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showSaid, setShowSaid] = useState(false);
  const [busy, setBusy] = useState<'save' | 'reject' | 'answer' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [fixText, setFixText] = useState('');
  // Bumped after a hand edit to reload the proposal and its remaining issues.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setLoaded(null);
    (async () => {
      const { data, error } = await supabase
        .from('change_sets')
        .select('status, created_at, operations, validation_issues, captures (raw_text, type)')
        .eq('id', id)
        .single();
      if (error || !data) {
        setLoadError('Could not load this note.');
        return;
      }
      const operations = (data.operations ?? []) as { tool: string; args: Args }[];
      const names = await loadNames(operations);
      const changes: Loaded['changes'] = [];
      const questions: Question[] = [];
      operations.forEach((op, index) => {
        if (op.tool === 'flag_ambiguity') {
          questions.push({
            question: op.args.question,
            excerpt: op.args.sourceExcerpt,
            options: (op.args.candidates ?? []).map((c: Args) => c.label as string),
          });
        } else changes.push({ index, described: describeOperation(op.tool, op.args, names), args: op.args });
      });
      setLoaded({
        status: data.status,
        createdAt: data.created_at,
        captureText: data.captures?.raw_text ?? '',
        captureType: data.captures?.type ?? 'text',
        changes,
        questions,
        issues: (data.validation_issues ?? []) as unknown as ValidationIssue[],
      });
      setSelected((prev) => (reloadKey > 0 && prev.size ? prev : new Set(changes.map((c) => c.index))));
    })();
  }, [id, reloadKey]);

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function run(kind: 'save' | 'reject', action: () => Promise<unknown>) {
    setError(null);
    setIssues([]);
    setBusy(kind);
    try {
      await action();
      void refresh();
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

  async function saveEdit(index: number, args: Args): Promise<string | null> {
    try {
      const { issues: left } = await worker.updateOperation(id, index, args);
      setEditing(null);
      setIssues(left);
      setReloadKey((k) => k + 1);
      return null;
    } catch (e) {
      return e instanceof WorkerError ? e.message : 'Could not save that edit.';
    }
  }

  async function typeFix() {
    if (!fixText.trim()) return;
    setError(null);
    setBusy('answer');
    try {
      const result = await worker.revise(id, { text: fixText.trim() });
      void refresh();
      setFixText('');
      if (result.changeSetId) router.replace(`/review/${result.changeSetId}`);
      else router.back();
    } catch (e) {
      setError(e instanceof WorkerError ? e.message : 'Something went wrong sending your fix.');
    } finally {
      setBusy(null);
    }
  }

  async function answer(question: string, reply: string) {
    if (!reply.trim()) return;
    setError(null);
    setBusy('answer');
    try {
      const result = await worker.answer(id, { question, answer: reply.trim() });
      void refresh();
      setTypedAnswer('');
      if (result.changeSetId) router.replace(`/review/${result.changeSetId}`);
      else router.back();
    } catch (e) {
      setError(e instanceof WorkerError ? e.message : 'Something went wrong sending your answer.');
    } finally {
      setBusy(null);
    }
  }

  if (loadError)
    return (
      <Screen>
        <Message text={loadError} tone="error" />
        <TextButton title="Back" onPress={() => router.back()} />
      </Screen>
    );
  if (!loaded) return <Loading />;

  const pending = loaded.status === 'pending';
  const count = loaded.changes.filter((c) => selected.has(c.index)).length;
  const shownIssues = issues.length ? issues : loaded.issues;
  const source = loaded.captureType === 'audio' ? 'voice note' : loaded.captureType === 'image' ? 'photo' : 'typed note';
  const firstQuestion = loaded.questions[0];

  return (
    <Screen
      footer={
        pending && loaded.changes.length > 0 ? (
          <>
            <BigButton
              title={count === 0 ? 'Nothing ticked' : `Save ${count} change${count === 1 ? '' : 's'}`}
              icon="check"
              disabled={count === 0 || busy === 'answer'}
              busy={busy === 'save'}
              onPress={() => run('save', () => worker.approve(id, count === loaded.changes.length ? undefined : [...selected]))}
            />
            <TextButton title="Throw it all out" busy={busy === 'reject'} onPress={() => run('reject', () => worker.reject(id))} />
          </>
        ) : pending ? (
          <TextButton title="Throw it all out" busy={busy === 'reject'} onPress={() => run('reject', () => worker.reject(id))} />
        ) : undefined
      }
    >
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <View style={{ flex: 1 }}>
          <Display size={28}>Check these</Display>
          <Small color={colors.muted}>From your {source}</Small>
        </View>
      </View>

      {busy === 'answer' && (
        <Card>
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <ActivityIndicator color={colors.accent} />
            <Strong size={17}>Updating with your answer…</Strong>
          </View>
        </Card>
      )}

      {pending &&
        loaded.questions.map((q, i) => (
          <Card key={`q${i}`} tone="accent" style={{ gap: 12 }}>
            <Text style={styles.questionLabel}>{i === 0 ? 'Which one?' : 'Also'}</Text>
            <Strong size={20}>{q.question}</Strong>
            {q.excerpt && <Small>“{q.excerpt}”</Small>}
            {q.options.map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                disabled={busy !== null}
                onPress={() => answer(q.question, option)}
                style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.optionText}>{option}</Text>
                <Feather name="chevron-right" size={22} color={colors.accent} />
              </Pressable>
            ))}
            {i === 0 && (
              <View style={styles.answerRow}>
                <TextInput
                  value={typedAnswer}
                  onChangeText={setTypedAnswer}
                  placeholder={q.options.length ? 'Or type an answer' : 'Type your answer'}
                  placeholderTextColor={colors.muted}
                  selectionColor={colors.accent}
                  style={styles.answerInput}
                  returnKeyType="send"
                  onSubmitEditing={() => answer(q.question, typedAnswer)}
                />
                <IconButton icon="send" label="Send answer" onPress={() => answer(q.question, typedAnswer)} />
              </View>
            )}
          </Card>
        ))}

      {loaded.changes.length > 0 && <SectionLabel>{pending ? (firstQuestion ? 'Ready to save anyway' : 'Ready to save') : 'Changes'}</SectionLabel>}
      {loaded.changes.map(({ index, described, args }) =>
        pending && editing === index ? (
          <Card key={index} tone="accent" style={{ gap: 12 }}>
            <Strong>{described.title}</Strong>
            <OperationEditor args={args} onSave={(next) => saveEdit(index, next)} onCancel={() => setEditing(null)} />
          </Card>
        ) : pending ? (
          <CheckRow key={index} checked={selected.has(index)} onToggle={() => toggle(index)}>
            <Strong>{described.title}</Strong>
            {described.details.map((d, j) => (
              <Small key={j}>{d}</Small>
            ))}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Edit ${described.title}`}
              onPress={() => setEditing(index)}
              hitSlop={8}
              style={styles.editLink}
            >
              <Feather name="edit-2" size={16} color={colors.accent} />
              <Text style={styles.editText}>Edit</Text>
            </Pressable>
          </CheckRow>
        ) : (
          <Card key={index}>
            <Strong>{described.title}</Strong>
            {described.details.map((d, j) => (
              <Small key={j}>{d}</Small>
            ))}
          </Card>
        ),
      )}

      {pending && editing === null && (
        <Card style={{ gap: 12 }}>
          <Strong size={18}>Something not right?</Strong>
          <Small>Say or type what to change and we'll redo it, like "it's three couplings, not two."</Small>
          <SecondaryButton title="Fix it by talking" icon="mic" busy={busy === 'answer'} onPress={() => router.push(`/record?revise=${id}`)} />
          <View style={styles.answerRow}>
            <TextInput
              value={fixText}
              onChangeText={setFixText}
              placeholder="Or type a fix"
              placeholderTextColor={colors.muted}
              selectionColor={colors.accent}
              style={[styles.answerInput, { borderColor: colors.borderStrong, backgroundColor: colors.surfaceSunk }]}
              returnKeyType="send"
              onSubmitEditing={() => void typeFix()}
            />
            <IconButton icon="send" label="Send fix" onPress={() => void typeFix()} />
          </View>
        </Card>
      )}

      {shownIssues.length > 0 && (
        <Card tone="danger">
          <Strong size={17}>These can't be saved as they are:</Strong>
          {shownIssues.map((iss, i) => (
            <Small key={i}>• {iss.message}</Small>
          ))}
        </Card>
      )}
      <Message text={error} tone="error" />

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showSaid }} onPress={() => setShowSaid(!showSaid)} style={styles.said}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.saidLabel}>What you said</Text>
          <Feather name={showSaid ? 'chevron-up' : 'chevron-down'} size={22} color={colors.muted} />
        </View>
        {showSaid && <Small>“{loaded.captureText}”</Small>}
      </Pressable>

      {!pending && <Small color={colors.muted}>This note was already {loaded.status === 'approved' ? 'saved' : 'thrown out'}.</Small>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: -12 },
  questionLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.accent, textTransform: 'uppercase', letterSpacing: 1.1 },
  option: {
    minHeight: 58,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.accentEdge,
    backgroundColor: '#1F1A14',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  optionText: { flex: 1, fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  answerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  answerInput: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.accentEdge,
    backgroundColor: '#1F1A14',
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 17,
    paddingHorizontal: 14,
  },
  said: { borderRadius: 14, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surfaceSunk, padding: 14, gap: 8, minHeight: 56, justifyContent: 'center' },
  saidLabel: { fontFamily: fonts.semibold, fontSize: 16, color: colors.muted },
  editLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 36, marginTop: 4 },
  editText: { fontFamily: fonts.bold, fontSize: 15, color: colors.accent },
});
