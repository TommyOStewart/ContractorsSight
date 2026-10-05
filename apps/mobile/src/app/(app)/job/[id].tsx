import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
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
  Small,
  StatusChip,
  Strong,
} from '../../../ui';

interface JobDetail {
  id: string;
  title: string;
  status: string;
  jobType: string | null;
  description: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  client: { name: string; phone: string | null; email: string | null } | null;
  site: { line1: string; city: string | null; label: string | null } | null;
  quote: { version: number; totalCents: number; lines: { description: string; quantity: number; unit: string | null; unitPriceCents: number }[] } | null;
  invoices: { number: number; status: string; totalCents: number; paidCents: number; issuedOn: string }[];
  materials: { id: string; description: string; quantity: number; unit: string | null; status: string; unitCostCents: number | null }[];
  notes: { id: string; body: string; createdAt: string }[];
}

// Whole dollars when even, otherwise always two decimals ($867.50, not $867.5).
const money = (cents: number) =>
  `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// A date-only value ("2026-10-04") is a calendar day; parsing it as UTC midnight shows the day before in the US.
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

async function loadJob(id: string): Promise<JobDetail | null> {
  const { data: j } = await supabase
    .from('jobs')
    .select(
      'id, title, status, job_type, description, scheduled_start, scheduled_end, clients (name, phone, email), sites!jobs_site_id_org_id_fkey (line1, city, label)',
    )
    .eq('id', id)
    .single();
  if (!j) return null;

  const [quotes, invoices, materials, notes] = await Promise.all([
    supabase.from('quotes').select('id, version, total_cents, quote_line_items (position, description, quantity, unit, unit_price_cents)').eq('job_id', id).order('version', { ascending: false }).limit(1),
    supabase.from('invoices').select('number, status, total_cents, issued_on, payments (amount_cents)').eq('job_id', id).neq('status', 'void').order('number'),
    supabase.from('material_items').select('id, description, quantity, unit, status, unit_cost_cents').eq('job_id', id).is('removed_at', null).order('created_at'),
    supabase.from('notes').select('id, body, created_at').eq('job_id', id).order('created_at', { ascending: false }).limit(10),
  ]);
  const q = quotes.data?.[0];
  return {
    id: j.id,
    title: j.title,
    status: j.status,
    jobType: j.job_type,
    description: j.description,
    scheduledStart: j.scheduled_start,
    scheduledEnd: j.scheduled_end,
    client: j.clients,
    site: j.sites,
    quote: q
      ? {
          version: q.version,
          totalCents: Number(q.total_cents),
          lines: [...(q.quote_line_items ?? [])]
            .sort((a, b) => a.position - b.position)
            .map((l) => ({ description: l.description, quantity: Number(l.quantity), unit: l.unit, unitPriceCents: Number(l.unit_price_cents) })),
        }
      : null,
    invoices: (invoices.data ?? []).map((i) => ({
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
  const [job, setJob] = useState<JobDetail | null | undefined>(undefined);

  // Reload whenever the screen comes back into view (e.g. after saving a capture about this job).
  useFocusEffect(
    useCallback(() => {
      void loadJob(id).then(setJob);
    }, [id]),
  );

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
          <StatusChip status={job.status} />
        </View>
      </View>

      <Card style={{ gap: 6 }}>
        {job.client && <Strong>{job.client.name}</Strong>}
        {address && <Small>{job.site?.label ? `${job.site.label} · ${address}` : address}</Small>}
        {job.scheduledStart && (
          <Small color={colors.success}>
            Scheduled {when(job.scheduledStart)}
            {job.scheduledEnd ? ` – ${new Date(job.scheduledEnd).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
          </Small>
        )}
        <View style={styles.contactRow}>
          {job.client?.phone && (
            <View style={{ flex: 1 }}>
              <SecondaryButton title="Call" icon="phone" onPress={() => void Linking.openURL(`tel:${job.client!.phone}`)} />
            </View>
          )}
          {address && (
            <View style={{ flex: 1 }}>
              <SecondaryButton
                title="Directions"
                icon="navigation"
                onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`)}
              />
            </View>
          )}
        </View>
      </Card>

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
                  {owed > 0 ? `Owes ${money(owed)}` : 'Paid in full'} · sent {day(inv.issuedOn)}
                </Small>
              </Card>
            );
          })}
        </>
      )}

      <SectionLabel>Materials</SectionLabel>
      {job.materials.length ? (
        <Card style={{ gap: 10 }}>
          {job.materials.map((m) => (
            <View key={m.id} style={styles.spread}>
              <View style={{ flex: 1 }}>
                <Small color={colors.text}>
                  {m.quantity}
                  {m.unit ? ` ${m.unit}` : ''} × {m.description}
                </Small>
              </View>
              <Small color={colors.muted}>{m.status}</Small>
            </View>
          ))}
        </Card>
      ) : (
        <Small color={colors.muted}>No materials yet.</Small>
      )}

      {job.notes.length > 0 && (
        <>
          <SectionLabel>Notes</SectionLabel>
          {job.notes.map((n) => (
            <Card key={n.id}>
              <Body>{n.body}</Body>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="clock" size={13} color={colors.muted} />
                <Small color={colors.muted}>{day(n.createdAt)}</Small>
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginLeft: -12 },
  contactRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
