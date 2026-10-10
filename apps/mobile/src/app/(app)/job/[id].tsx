import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { JOB_STATUS_TRANSITIONS, type JobStatus } from '@contractorsight/shared';
import { useSession } from '../../../auth/SessionProvider';
import { ContactActions } from '../../../contact/ContactActions';
import { sendDocument } from '../../../contact/sendDocument';
import { NoteComposer } from '../../../edit/NoteComposer';
import { changedFields, saveEdit } from '../../../edit/saveEdit';
import { ScheduleEditor } from '../../../edit/ScheduleEditor';
import { OperationEditor } from '../../../review/OperationEditor';
import { supabase } from '../../../lib/supabase';
import {
  BigButton,
  Body,
  Card,
  colors,
  Display,
  IconButton,
  Loading,
  Message,
  Screen,
  SecondaryButton,
  SectionLabel,
  statusColors,
  Small,
  StatusChip,
  Strong,
  TextButton,
} from '../../../ui';

interface JobDetail {
  id: string;
  title: string;
  status: JobStatus;
  /** As loaded; sent with edits so a change made on a stale screen is refused. */
  version: number;
  jobType: string | null;
  description: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  client: { id: string; name: string; phone: string | null; email: string | null } | null;
  site: { line1: string; city: string | null; label: string | null } | null;
  quote: {
    id: string;
    version: number;
    status: string;
    sentAt: string | null;
    acceptedAt: string | null;
    acceptedByName: string | null;
    totalCents: number;
    lines: { description: string; quantity: number; unit: string | null; unitPriceCents: number }[];
  } | null;
  invoices: { id: string; number: number; status: string; totalCents: number; paidCents: number; issuedOn: string; sentAt: string | null }[];
  materials: { id: string; description: string; quantity: number; unit: string | null; status: string; unitCostCents: number | null }[];
  notes: { id: string; body: string; createdAt: string }[];
}

// Whole dollars when even, otherwise always two decimals ($867.50, not $867.5).
const money = (cents: number) => `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// A date-only value ("2026-10-04") is a calendar day; parsing it as UTC midnight shows the day before in the US.
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

async function loadJob(id: string): Promise<JobDetail | null> {
  const { data: j } = await supabase
    .from('jobs')
    .select(
      'id, title, status, version, job_type, description, scheduled_start, scheduled_end, clients (id, name, phone, email), sites!jobs_site_id_org_id_fkey (line1, city, label)',
    )
    .eq('id', id)
    .single();
  if (!j) return null;

  const [quotes, invoices, materials, notes] = await Promise.all([
    supabase
      .from('quotes')
      .select(
        'id, version, status, sent_at, accepted_at, accepted_by_name, total_cents, quote_line_items (position, description, quantity, unit, unit_price_cents)',
      )
      .eq('job_id', id)
      .order('version', { ascending: false })
      .limit(1),
    supabase
      .from('invoices')
      .select('id, number, status, total_cents, issued_on, sent_at, payments (amount_cents)')
      .eq('job_id', id)
      .neq('status', 'void')
      .order('number'),
    supabase
      .from('material_items')
      .select('id, description, quantity, unit, status, unit_cost_cents')
      .eq('job_id', id)
      .is('removed_at', null)
      .order('created_at'),
    supabase.from('notes').select('id, body, created_at').eq('job_id', id).order('created_at', { ascending: false }).limit(10),
  ]);
  const q = quotes.data?.[0];
  return {
    id: j.id,
    title: j.title,
    status: j.status,
    version: j.version,
    jobType: j.job_type,
    description: j.description,
    scheduledStart: j.scheduled_start,
    scheduledEnd: j.scheduled_end,
    client: j.clients,
    site: j.sites,
    quote: q
      ? {
          id: q.id,
          version: q.version,
          status: q.status,
          sentAt: q.sent_at,
          acceptedAt: q.accepted_at,
          acceptedByName: q.accepted_by_name,
          totalCents: Number(q.total_cents),
          lines: [...(q.quote_line_items ?? [])]
            .sort((a, b) => a.position - b.position)
            .map((l) => ({ description: l.description, quantity: Number(l.quantity), unit: l.unit, unitPriceCents: Number(l.unit_price_cents) })),
        }
      : null,
    invoices: (invoices.data ?? []).map((i) => ({
      id: i.id,
      sentAt: i.sent_at,
      number: i.number,
      status: i.status,
      totalCents: Number(i.total_cents),
      paidCents: (i.payments ?? []).reduce((s, p) => s + Number(p.amount_cents), 0),
      issuedOn: i.issued_on,
    })),
    materials: (materials.data ?? []).map((m) => ({
      id: m.id,
      description: m.description,
      quantity: Number(m.quantity),
      unit: m.unit,
      status: m.status,
      unitCostCents: m.unit_cost_cents === null ? null : Number(m.unit_cost_cents),
    })),
    notes: (notes.data ?? []).map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at })),
  };
}

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { memberships } = useSession();
  const orgId = memberships[0]!.orgId;
  const company = memberships[0]!.orgName;
  const [job, setJob] = useState<JobDetail | null | undefined>(undefined);
  /** 'details', 'schedule', 'status', 'add-material', a material ID, or null. */
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** Which document is being sent, and anything to show about it afterwards. */
  const [sending, setSending] = useState<string | null>(null);
  const [sendNote, setSendNote] = useState<{ id: string; message: string; url?: string } | null>(null);

  async function send(kind: 'quote' | 'invoice', id: string, invoiceNumber?: number) {
    setSending(id);
    setSendNote(null);
    const result = await sendDocument({ kind, id, company, customerName: job!.client?.name ?? null, jobTitle: job!.title, invoiceNumber });
    setSending(null);
    if (!result.ok) setSendNote({ id, message: result.message, url: result.url });
    await reload();
  }

  // Reload whenever the screen comes back into view (e.g. after saving a capture about this job).
  const reload = useCallback(() => loadJob(id).then(setJob), [id]);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  /** Applies a hand edit against the version on screen, then reloads. Returns a problem, or null. */
  async function apply(operations: { tool: string; args: Record<string, unknown> }[]) {
    const result = await saveEdit(orgId, operations, { [id]: job!.version });
    if (result) return result;
    setEditing(null);
    setProblem(null);
    await reload();
    return null;
  }

  if (job === undefined) return <Loading />;
  if (job === null)
    return (
      <Screen>
        <Message text="Could not find this job." tone="error" />
      </Screen>
    );

  const address = job.site ? [job.site.line1, job.site.city].filter(Boolean).join(', ') : null;
  const about = `jobId=${job.id}&jobTitle=${encodeURIComponent(job.title)}`;

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <View style={{ flex: 1, gap: 6 }}>
          <Display size={28}>{job.title}</Display>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Change status"
            onPress={() => setEditing(editing === 'status' ? null : 'status')}
            style={styles.statusRow}
          >
            <StatusChip status={job.status} />
            {nextStatuses(job.status).length > 0 && <Feather name="chevron-down" size={18} color={colors.muted} />}
          </Pressable>
        </View>
        <IconButton icon="edit-2" label="Edit job" onPress={() => setEditing(editing === 'details' ? null : 'details')} />
      </View>

      {editing === 'status' && (
        <Card tone="accent" style={{ gap: 10 }}>
          <Strong>Move this job to…</Strong>
          {nextStatuses(job.status).length === 0 && <Small>This job is closed.</Small>}
          <View style={styles.choices}>
            {nextStatuses(job.status).map((to) => (
              <SecondaryButton
                key={to}
                title={statusColors[to]?.label ?? to}
                onPress={() =>
                  // Scheduling needs a time, so it opens the scheduler instead.
                  to === 'scheduled'
                    ? setEditing('schedule')
                    : void apply([{ tool: 'request_status_change', args: { jobId: job.id, toStatus: to } }]).then(setProblem)
                }
              />
            ))}
          </View>
          <Message text={problem} tone="error" />
        </Card>
      )}

      {editing === 'details' && (
        <Card tone="accent" style={{ gap: 12 }}>
          <Strong>Edit job</Strong>
          <OperationEditor
            args={detailFields(job)}
            saveTitle="Save"
            onSave={async (next) => {
              const changes = changedFields(detailFields(job), next);
              if (!Object.keys(changes).length) {
                setEditing(null);
                return null;
              }
              return apply([{ tool: 'update_job_fields', args: { jobId: job.id, changes } }]);
            }}
            onCancel={() => setEditing(null)}
          />
        </Card>
      )}

      <Card style={{ gap: 6 }}>
        {job.client && (
          <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/customer/[id]', params: { id: job.client!.id } })}>
            <View style={styles.spread}>
              <Strong>{job.client.name}</Strong>
              <Feather name="chevron-right" size={22} color={colors.muted} />
            </View>
          </Pressable>
        )}
        {job.jobType && <Small color={colors.muted}>{job.jobType.charAt(0).toUpperCase() + job.jobType.slice(1)}</Small>}
        {address && <Small>{job.site?.label ? `${job.site.label} · ${address}` : address}</Small>}
        {job.scheduledStart && (
          <Small color={colors.success}>
            Scheduled {when(job.scheduledStart)}
            {job.scheduledEnd ? ` – ${new Date(job.scheduledEnd).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
          </Small>
        )}
        {(job.status === 'accepted' || job.status === 'scheduled') && editing !== 'schedule' && (
          <Pressable accessibilityRole="button" onPress={() => setEditing('schedule')}>
            <Small color={colors.accent}>{job.scheduledStart ? 'Change the time' : 'Pick a day and time'}</Small>
          </Pressable>
        )}
        {job.client && (
          <ContactActions
            name={job.client.name}
            phone={job.client.phone}
            address={address}
            owedCents={job.invoices.reduce((sum, i) => sum + Math.max(0, i.totalCents - i.paidCents), 0)}
          />
        )}
      </Card>

      {editing === 'schedule' && (
        <Card tone="accent" style={{ gap: 12 }}>
          <Strong>
            {job.scheduledStart ? 'Reschedule' : 'Schedule'} {job.title}
          </Strong>
          <ScheduleEditor
            start={job.scheduledStart}
            end={job.scheduledEnd}
            onSave={(start, end) => apply([{ tool: 'schedule_job', args: { jobId: job.id, start, end } }])}
            onCancel={() => setEditing(null)}
          />
        </Card>
      )}

      <BigButton title="Talk about this job" icon="mic" onPress={() => router.push(`/record?${about}`)} />
      <View style={styles.contactRow}>
        <View style={{ flex: 1 }}>
          <SecondaryButton title="Photo" icon="camera" onPress={() => router.push(`/photo?${about}`)} />
        </View>
        <View style={{ flex: 1 }}>
          <SecondaryButton title="Type" icon="type" onPress={() => router.push(`/type?${about}`)} />
        </View>
      </View>

      {job.description && (
        <>
          <SectionLabel>Scope</SectionLabel>
          <Body>{job.description}</Body>
        </>
      )}

      <SectionLabel>Quote</SectionLabel>
      {job.quote ? (
        <Card>
          <View style={styles.spread}>
            <Strong>Version {job.quote.version}</Strong>
            <Strong>{money(job.quote.totalCents)}</Strong>
          </View>
          {job.quote.lines.map((l, i) => (
            <View key={i} style={styles.spread}>
              <View style={{ flex: 1 }}>
                <Small>
                  {l.description} · {l.quantity}
                  {l.unit ? ` ${l.unit}` : ''}
                </Small>
              </View>
              <Small>{money(Math.round(l.quantity * l.unitPriceCents))}</Small>
            </View>
          ))}
          {job.quote.acceptedAt ? (
            <Small color={colors.success}>
              Approved{job.quote.acceptedByName ? ` by ${job.quote.acceptedByName}` : ''} {day(job.quote.acceptedAt)}
            </Small>
          ) : job.quote.sentAt ? (
            <Small color={colors.muted}>Sent {day(job.quote.sentAt)}. Waiting for the customer to approve.</Small>
          ) : null}
          {job.quote.status !== 'superseded' && job.quote.status !== 'rejected' && (
            <SecondaryButton
              title={job.quote.acceptedAt ? 'Send a copy' : job.quote.sentAt ? 'Send again' : 'Send to customer'}
              icon="send"
              busy={sending === job.quote.id}
              onPress={() => void send('quote', job.quote!.id)}
            />
          )}
          <SendNote note={sendNote} id={job.quote.id} />
        </Card>
      ) : (
        <Small color={colors.muted}>No quote yet. Say the price breakdown and it'll be drafted for you.</Small>
      )}

      {job.invoices.length > 0 && (
        <>
          <SectionLabel>Invoices</SectionLabel>
          {job.invoices.map((inv) => {
            const owed = inv.totalCents - inv.paidCents;
            return (
              <Card key={inv.number}>
                <View style={styles.spread}>
                  <Strong>Invoice #{inv.number}</Strong>
                  <Strong>{money(inv.totalCents)}</Strong>
                </View>
                <Small color={owed > 0 ? colors.accent : colors.success}>
                  {owed > 0 ? `Owes ${money(owed)}` : 'Paid in full'} · {inv.sentAt ? `sent ${day(inv.sentAt)}` : `made ${day(inv.issuedOn)}, not sent yet`}
                </Small>
                {owed > 0 && (
                  <SecondaryButton
                    title={inv.sentAt ? 'Send again' : 'Send to customer'}
                    icon="send"
                    busy={sending === inv.id}
                    onPress={() => void send('invoice', inv.id, inv.number)}
                  />
                )}
                <SendNote note={sendNote} id={inv.id} />
              </Card>
            );
          })}
        </>
      )}

      <SectionLabel>Materials</SectionLabel>
      {job.materials.map((m) =>
        editing === m.id ? (
          <Card key={m.id} tone="accent" style={{ gap: 12 }}>
            <Strong>Edit {m.description}</Strong>
            <OperationEditor
              args={materialFields(m)}
              saveTitle="Save"
              onSave={async (next) => {
                const changes = changedFields(materialFields(m), next);
                if (!Object.keys(changes).length) {
                  setEditing(null);
                  return null;
                }
                return apply([{ tool: 'update_material', args: { materialId: m.id, changes } }]);
              }}
              onCancel={() => setEditing(null)}
            />
            <TextButton
              title="Remove from this job"
              color={colors.danger}
              onPress={() => void apply([{ tool: 'remove_material', args: { materialId: m.id } }]).then(setProblem)}
            />
            <Message text={problem} tone="error" />
          </Card>
        ) : (
          <Card key={m.id} onPress={() => setEditing(m.id)} style={styles.materialRow}>
            <View style={{ flex: 1 }}>
              <Small color={colors.text}>
                {m.quantity}
                {m.unit ? ` ${m.unit}` : ''} × {m.description}
              </Small>
            </View>
            <Small color={colors.muted}>{m.status}</Small>
            <Feather name="edit-2" size={16} color={colors.muted} />
          </Card>
        ),
      )}
      {editing === 'add-material' ? (
        <Card tone="accent" style={{ gap: 12 }}>
          <Strong>Add a part</Strong>
          <OperationEditor
            args={{ description: '', quantity: 1, unit: '', unitCostDollars: '' }}
            saveTitle="Add"
            onSave={(next) => apply([{ tool: 'add_material', args: { jobId: job.id, ...next } }])}
            onCancel={() => setEditing(null)}
          />
        </Card>
      ) : (
        <SecondaryButton title="Add a part" icon="plus" onPress={() => setEditing('add-material')} />
      )}

      <SectionLabel>Notes</SectionLabel>
      <NoteComposer onSave={(body) => apply([{ tool: 'add_note', args: { jobId: job.id, body } }])} />
      {job.notes.map((n) => (
        <Card key={n.id}>
          <Body>{n.body}</Body>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="clock" size={13} color={colors.muted} />
            <Small color={colors.muted}>{day(n.createdAt)}</Small>
          </View>
        </Card>
      ))}
    </Screen>
  );
}

/** What happened after tapping Send, under the document it was about. */
function SendNote({ note, id }: { note: { id: string; message: string; url?: string } | null; id: string }) {
  if (!note || note.id !== id) return null;
  return (
    <View style={{ gap: 4 }}>
      <Small color={note.url ? colors.textSoft : colors.danger}>{note.message}</Small>
      {note.url && (
        <Text selectable style={styles.link}>
          {note.url}
        </Text>
      )}
    </View>
  );
}

const nextStatuses = (status: JobStatus) => JOB_STATUS_TRANSITIONS[status];

// Every editable field is listed (blank when empty) so the editor shows it.
const detailFields = (j: JobDetail) => ({ title: j.title, jobType: j.jobType ?? '', description: j.description ?? '' });
const materialFields = (m: JobDetail['materials'][number]) => ({
  description: m.description,
  quantity: m.quantity,
  unit: m.unit ?? '',
  unitCostDollars: m.unitCostCents === null ? '' : m.unitCostCents / 100,
  status: m.status,
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginLeft: -12 },
  contactRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  link: { color: colors.accent, fontSize: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  choices: { gap: 8 },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
});
