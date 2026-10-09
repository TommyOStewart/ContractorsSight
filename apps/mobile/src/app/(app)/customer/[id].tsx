import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSession } from '../../../auth/SessionProvider';
import { ContactActions } from '../../../contact/ContactActions';
import { NoteComposer } from '../../../edit/NoteComposer';
import { changedFields, saveEdit } from '../../../edit/saveEdit';
import { supabase } from '../../../lib/supabase';
import { OperationEditor } from '../../../review/OperationEditor';
import { Body, Card, colors, Display, IconButton, Loading, Message, Screen, SectionLabel, Small, StatusChip, Strong } from '../../../ui';

interface CustomerDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  sites: { id: string; line1: string; city: string | null; label: string | null; accessNotes: string | null }[];
  jobs: { id: string; title: string; status: string; updatedAt: string; scheduledStart: string | null; billedCents: number; owedCents: number }[];
  jobNotes: { id: string; body: string; createdAt: string }[];
}

const CLOSED = new Set(['paid', 'declined', 'cancelled']);
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

async function loadCustomer(id: string): Promise<CustomerDetail | null> {
  const { data: c } = await supabase
    .from('clients')
    .select(
      'id, name, phone, email, notes, sites (id, line1, city, label, access_notes), jobs (id, title, status, updated_at, scheduled_start, invoices (status, total_cents, payments (amount_cents)))',
    )
    .eq('id', id)
    .single();
  if (!c) return null;
  const { data: notes } = await supabase.from('notes').select('id, body, created_at').eq('client_id', id).order('created_at', { ascending: false }).limit(10);

  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    notes: c.notes,
    sites: (c.sites ?? []).map((s) => ({ id: s.id, line1: s.line1, city: s.city, label: s.label, accessNotes: s.access_notes })),
    jobs: (c.jobs ?? [])
      .map((j) => {
        const invoices = (j.invoices ?? []).filter((i) => i.status !== 'void');
        const paid = (i: (typeof invoices)[number]) => (i.payments ?? []).reduce((s, p) => s + Number(p.amount_cents), 0);
        return {
          id: j.id,
          title: j.title,
          status: j.status,
          updatedAt: j.updated_at,
          scheduledStart: j.scheduled_start,
          billedCents: invoices.reduce((s, i) => s + Number(i.total_cents), 0),
          owedCents: invoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + Math.max(0, Number(i.total_cents) - paid(i)), 0),
        };
      })
      // Open work first, then most recently touched.
      .sort((a, b) => Number(CLOSED.has(a.status)) - Number(CLOSED.has(b.status)) || b.updatedAt.localeCompare(a.updatedAt)),
    jobNotes: (notes ?? []).map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at })),
  };
}

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { memberships } = useSession();
  const orgId = memberships[0]!.orgId;
  const [customer, setCustomer] = useState<CustomerDetail | null | undefined>(undefined);
  /** 'client', a site ID, or null. */
  const [editing, setEditing] = useState<string | null>(null);

  const reload = useCallback(() => loadCustomer(id).then(setCustomer), [id]);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  /** Saves only what changed, then reloads. Returns a problem to show, or null. */
  async function save(tool: 'update_client' | 'update_site', key: Record<string, string>, before: Record<string, unknown>, next: Record<string, unknown>) {
    const changes = changedFields(before, next);
    if (Object.keys(changes).length) {
      const problem = await saveEdit(orgId, [{ tool, args: { ...key, changes } }]);
      if (problem) return problem;
      await reload();
    }
    setEditing(null);
    return null;
  }

  if (customer === undefined) return <Loading />;
  if (customer === null)
    return (
      <Screen>
        <Message text="Could not find this customer." tone="error" />
      </Screen>
    );

  const site = customer.sites[0];
  const address = site ? [site.line1, site.city].filter(Boolean).join(', ') : null;
  const billed = customer.jobs.reduce((s, j) => s + j.billedCents, 0);
  const owed = customer.jobs.reduce((s, j) => s + j.owedCents, 0);

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <View style={{ flex: 1, gap: 4 }}>
          <Display size={28}>{customer.name}</Display>
          {customer.phone && <Small>{customer.phone}</Small>}
          {customer.email && (
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`mailto:${customer.email}`)}>
              <Small color={colors.accent}>{customer.email}</Small>
            </Pressable>
          )}
        </View>
        <IconButton icon="edit-2" label="Edit customer" onPress={() => setEditing(editing === 'client' ? null : 'client')} />
      </View>

      {editing === 'client' && (
        <Card tone="accent" style={{ gap: 12 }}>
          <Strong>Edit {customer.name}</Strong>
          <OperationEditor
            args={clientFields(customer)}
            saveTitle="Save"
            onSave={(next) => save('update_client', { clientId: customer.id }, clientFields(customer), next)}
            onCancel={() => setEditing(null)}
          />
        </Card>
      )}

      <ContactActions name={customer.name} phone={customer.phone} address={address} owedCents={owed} />
      {!customer.phone && editing !== 'client' && (
        <Pressable accessibilityRole="button" onPress={() => setEditing('client')}>
          <Small color={colors.accent}>No phone number yet. Tap to add one.</Small>
        </Pressable>
      )}

      <View style={styles.stats}>
        <Card style={styles.stat}>
          <Small color={colors.muted}>Jobs</Small>
          <Strong size={24}>{customer.jobs.length}</Strong>
        </Card>
        <Card style={styles.stat}>
          <Small color={colors.muted}>Billed</Small>
          <Strong size={24}>{money(billed)}</Strong>
        </Card>
        <Card style={styles.stat} tone={owed > 0 ? 'accent' : 'plain'}>
          <Small color={colors.muted}>Owes</Small>
          <Strong size={24}>{money(owed)}</Strong>
        </Card>
      </View>

      <SectionLabel>Jobs</SectionLabel>
      {customer.jobs.length ? (
        customer.jobs.map((j) => (
          <Card key={j.id} onPress={() => router.push({ pathname: '/job/[id]', params: { id: j.id } })}>
            <View style={styles.spread}>
              <View style={{ flex: 1 }}>
                <Strong>{j.title}</Strong>
              </View>
              <StatusChip status={j.status} />
            </View>
            <Small color={j.owedCents > 0 ? colors.accent : colors.muted}>
              {[j.owedCents > 0 ? `Owes ${money(j.owedCents)}` : j.billedCents ? `Billed ${money(j.billedCents)}` : null, `Updated ${day(j.updatedAt)}`]
                .filter(Boolean)
                .join(' · ')}
            </Small>
          </Card>
        ))
      ) : (
        <Small color={colors.muted}>No jobs yet.</Small>
      )}

      {customer.sites.length > 0 && (
        <>
          <SectionLabel>{customer.sites.length === 1 ? 'Address' : 'Addresses'}</SectionLabel>
          {customer.sites.map((s) =>
            editing === s.id ? (
              <Card key={s.id} tone="accent" style={{ gap: 12 }}>
                <Strong>Edit address</Strong>
                <OperationEditor
                  args={siteFields(s)}
                  saveTitle="Save"
                  onSave={(next) => save('update_site', { siteId: s.id }, siteFields(s), next)}
                  onCancel={() => setEditing(null)}
                />
              </Card>
            ) : (
              <Card key={s.id} style={{ gap: 4 }} onPress={() => setEditing(s.id)}>
                <View style={styles.spread}>
                  <View style={{ flex: 1 }}>
                    {s.label && <Strong>{s.label}</Strong>}
                    <Body>{[s.line1, s.city].filter(Boolean).join(', ')}</Body>
                  </View>
                  <Feather name="edit-2" size={18} color={colors.muted} />
                </View>
                {s.accessNotes ? (
                  <Small color={colors.muted}>{s.accessNotes}</Small>
                ) : (
                  <Small color={colors.muted}>Tap to add a gate code or access notes</Small>
                )}
              </Card>
            ),
          )}
        </>
      )}

      <SectionLabel>Notes</SectionLabel>
      <NoteComposer
        onSave={async (body) => {
          const problem = await saveEdit(orgId, [{ tool: 'add_note', args: { clientId: customer.id, body } }]);
          if (!problem) await reload();
          return problem;
        }}
      />
      {customer.notes && (
        <Card>
          <Body>{customer.notes}</Body>
        </Card>
      )}
      {customer.jobNotes.map((n) => (
        <Card key={n.id}>
          <Body>{n.body}</Body>
          <Small color={colors.muted}>{day(n.createdAt)}</Small>
        </Card>
      ))}
    </Screen>
  );
}

// Every editable field is listed (blank when empty) so the editor shows it.
const clientFields = (c: CustomerDetail) => ({ name: c.name, phone: c.phone ?? '', email: c.email ?? '', notes: c.notes ?? '' });
const siteFields = (s: CustomerDetail['sites'][number]) => ({
  label: s.label ?? '',
  line1: s.line1,
  city: s.city ?? '',
  accessNotes: s.accessNotes ?? '',
});

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 4, marginLeft: -12 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, gap: 2, paddingVertical: 12 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 },
});
