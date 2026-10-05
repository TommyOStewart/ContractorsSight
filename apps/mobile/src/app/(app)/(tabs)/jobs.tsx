import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSession } from '../../../auth/SessionProvider';
import { JobCalendar } from '../../../calendar/JobCalendar';
import { supabase } from '../../../lib/supabase';
import { Body, Card, colors, Display, fonts, Screen, Small, StatusChip, Strong } from '../../../ui';

interface JobRow {
  id: string;
  title: string;
  status: string;
  jobType: string | null;
  client: string;
  address: string | null;
  materials: number;
  scheduledStart: string | null;
  quoteCents: number | null;
  /** Billed but not yet paid, across the job's invoices. */
  owedCents: number;
}

type Filter = 'active' | 'week' | 'all';
const CLOSED = new Set(['paid', 'declined', 'cancelled']);

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Find a job and see where it stands, as a list or on the calendar. Open one to edit it.
export default function JobsScreen() {
  const { memberships } = useSession();
  const orgId = memberships[0]!.orgId;
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [kind, setKind] = useState<string | null>(null);
  const [mode, setMode] = useState<'list' | 'calendar'>('list');

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const { data } = await supabase
          .from('jobs')
          .select(
            'id, title, status, job_type, scheduled_start, clients (name), sites!jobs_site_id_org_id_fkey (line1), material_items (id, removed_at), quotes (version, total_cents), invoices (status, total_cents, payments (amount_cents))',
          )
          .eq('org_id', orgId)
          .order('updated_at', { ascending: false })
          .limit(200);
        setJobs(
          (data ?? []).map((row) => {
            const latest = [...(row.quotes ?? [])].sort((a, b) => b.version - a.version)[0];
            return {
              id: row.id,
              title: row.title,
              status: row.status,
              jobType: row.job_type,
              client: row.clients?.name ?? '',
              address: row.sites?.line1 ?? null,
              materials: (row.material_items ?? []).filter((m) => !m.removed_at).length,
              scheduledStart: row.scheduled_start,
              quoteCents: latest ? Number(latest.total_cents) : null,
              owedCents: (row.invoices ?? [])
                .filter((i) => i.status === 'sent' || i.status === 'draft')
                .reduce((sum, i) => sum + Number(i.total_cents) - (i.payments ?? []).reduce((p, x) => p + Number(x.amount_cents), 0), 0),
            };
          }),
        );
      })();
    }, [orgId]),
  );

  const shown = useMemo(() => {
    const weekAhead = Date.now() + 7 * 24 * 3600_000;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return jobs
      .filter((j) =>
        filter === 'all'
          ? true
          : filter === 'active'
            ? !CLOSED.has(j.status)
            : !!j.scheduledStart && new Date(j.scheduledStart).getTime() <= weekAhead && new Date(j.scheduledStart).getTime() >= Date.now() - 24 * 3600_000,
      )
      .filter((j) => !kind || j.jobType === kind)
      .filter((j) => words.every((w) => `${j.title} ${j.client} ${j.address ?? ''} ${j.jobType ?? ''}`.toLowerCase().includes(w)));
  }, [jobs, query, filter, kind]);

  // Only the kinds of work this company actually has, most common first.
  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const j of jobs) if (j.jobType) counts.set(j.jobType, (counts.get(j.jobType) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [jobs]);

  return (
    <Screen>
      <Display>Jobs</Display>
      <View style={styles.modes}>
        {(
          [
            ['list', 'List', 'list'],
            ['calendar', 'Calendar', 'calendar'],
          ] as const
        ).map(([key, label, icon]) => (
          <Pressable
            key={key}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === key }}
            onPress={() => setMode(key)}
            style={[styles.mode, mode === key && styles.modeOn]}
          >
            <Feather name={icon} size={18} color={mode === key ? colors.onAccent : colors.text} />
            <Text style={[styles.pillText, mode === key && styles.pillTextOn]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {mode === 'calendar' ? (
        <JobCalendar orgId={orgId} />
      ) : (
        <>
          <View style={styles.search}>
            <Feather name="search" size={22} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Name, street, or job"
              placeholderTextColor={colors.muted}
              selectionColor={colors.accent}
              accessibilityLabel="Search jobs"
              style={styles.searchInput}
              returnKeyType="search"
            />
          </View>
          <View style={styles.filters}>
            {(
              [
                ['active', 'Active'],
                ['week', 'This week'],
                ['all', 'All'],
              ] as const
            ).map(([key, label]) => (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === key }}
                onPress={() => setFilter(key)}
                style={[styles.pill, filter === key && styles.pillOn]}
              >
                <Text style={[styles.pillText, filter === key && styles.pillTextOn]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {kinds.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds}>
              {[null, ...kinds].map((k) => (
                <Pressable
                  key={k ?? 'any'}
                  accessibilityRole="button"
                  accessibilityState={{ selected: kind === k }}
                  onPress={() => setKind(k)}
                  style={[styles.kind, kind === k && styles.kindOn]}
                >
                  <Text style={[styles.kindText, kind === k && styles.pillTextOn]}>{k ? capitalize(k) : 'Any kind'}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          {shown.length === 0 && (
            <Card>
              <Strong>No jobs here</Strong>
              <Body muted>{query ? 'Nothing matches that search.' : 'Jobs you talk about show up here once you save them.'}</Body>
            </Card>
          )}
          {shown.map((j) => (
            <Card key={j.id} onPress={() => router.push({ pathname: '/job/[id]', params: { id: j.id } })}>
              <View style={styles.titleRow}>
                <View style={{ flex: 1 }}>
                  <Strong>{j.title}</Strong>
                </View>
                <StatusChip status={j.status} label={j.status === 'scheduled' && j.scheduledStart ? when(j.scheduledStart) : undefined} />
              </View>
              <Small>
                {[
                  j.client,
                  j.address,
                  j.jobType && !kind ? capitalize(j.jobType) : null,
                  j.owedCents > 0 ? `Owes ${money(j.owedCents)}` : j.quoteCents !== null ? `Quote ${money(j.quoteCents)}` : null,
                  j.materials ? `${j.materials} part${j.materials === 1 ? '' : 's'}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Small>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const styles = StyleSheet.create({
  search: {
    height: 58,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 18, height: '100%' },
  filters: { flexDirection: 'row', gap: 8 },
  pill: { minHeight: 46, paddingHorizontal: 18, borderRadius: 23, borderWidth: 2, borderColor: colors.borderStrong, justifyContent: 'center' },
  pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  pillTextOn: { fontFamily: fonts.bold, color: colors.onAccent },
  modes: { flexDirection: 'row', borderRadius: 14, borderWidth: 2, borderColor: colors.borderStrong, padding: 3, gap: 3 },
  mode: { flex: 1, minHeight: 46, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  modeOn: { backgroundColor: colors.accent },
  kinds: { gap: 8, paddingRight: 20 },
  kind: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  kindOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  kindText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textSoft },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
});
