import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { Card, colors, fonts, IconButton, SectionLabel, Small, StatusChip, Strong } from '../ui';

interface PlannedJob {
  id: string;
  title: string;
  status: string;
  start: Date;
  end: Date | null;
  client: string;
  address: string | null;
}

interface ReadyJob {
  id: string;
  title: string;
  client: string;
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfWeek = (d: Date) => addDays(startOfDay(d), -d.getDay());
/** The six weeks shown for a month: from the Sunday on or before the 1st. */
const monthGrid = (month: Date) => {
  const first = startOfWeek(new Date(month.getFullYear(), month.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
};
const time = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * Month at a glance; tap a day to see that week with each day's jobs in order.
 * Shows scheduled work (anything with a start time) plus accepted jobs still waiting for a day.
 */
export function JobCalendar({ orgId }: { orgId: string }) {
  const [view, setView] = useState<'month' | 'week'>('month');
  /** First of the month in month view; the Sunday of the week in week view. */
  const [anchor, setAnchor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [picked, setPicked] = useState<Date>(() => startOfDay(new Date()));
  const [jobs, setJobs] = useState<PlannedJob[]>([]);
  const [ready, setReady] = useState<ReadyJob[]>([]);

  // A week always fits inside the grid of the month its Sunday falls in, so one query covers both views.
  const grid = useMemo(() => monthGrid(anchor), [anchor]);
  const rangeStart = grid[0]!;
  const rangeEnd = addDays(grid[41]!, 1);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const [planned, waiting] = await Promise.all([
          supabase
            .from('jobs')
            .select('id, title, status, scheduled_start, scheduled_end, clients (name), sites!jobs_site_id_org_id_fkey (line1)')
            .eq('org_id', orgId)
            .gte('scheduled_start', rangeStart.toISOString())
            .lt('scheduled_start', rangeEnd.toISOString())
            .not('status', 'in', '(cancelled,declined)')
            .order('scheduled_start'),
          supabase.from('jobs').select('id, title, clients (name)').eq('org_id', orgId).eq('status', 'accepted').is('scheduled_start', null).limit(20),
        ]);
        setJobs(
          (planned.data ?? []).map((j) => ({
            id: j.id,
            title: j.title,
            status: j.status,
            start: new Date(j.scheduled_start!),
            end: j.scheduled_end ? new Date(j.scheduled_end) : null,
            client: j.clients?.name ?? '',
            address: j.sites?.line1 ?? null,
          })),
        );
        setReady((waiting.data ?? []).map((j) => ({ id: j.id, title: j.title, client: j.clients?.name ?? '' })));
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orgId, rangeStart.getTime()]),
  );

  const onDay = (d: Date) => jobs.filter((j) => sameDay(j.start, d));
  const today = startOfDay(new Date());

  function openWeek(day: Date) {
    setPicked(day);
    setAnchor(startOfWeek(day));
    setView('week');
  }

  function step(direction: 1 | -1) {
    setAnchor((a) => (view === 'month' ? new Date(a.getFullYear(), a.getMonth() + direction, 1) : addDays(a, 7 * direction)));
  }

  const title =
    view === 'month'
      ? anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : `${anchor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${addDays(anchor, 6).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <View style={{ gap: 12 }}>
      <View style={styles.header}>
        <IconButton icon="chevron-left" label={view === 'month' ? 'Previous month' : 'Previous week'} onPress={() => step(-1)} />
        <Text style={styles.title}>{title}</Text>
        <IconButton icon="chevron-right" label={view === 'month' ? 'Next month' : 'Next week'} onPress={() => step(1)} />
      </View>
      <View style={styles.switchRow}>
        {view === 'week' && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setAnchor(new Date(picked.getFullYear(), picked.getMonth(), 1));
              setView('month');
            }}
            style={styles.link}
          >
            <Feather name="grid" size={16} color={colors.accent} />
            <Text style={styles.linkText}>Month</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => (view === 'month' ? setAnchor(new Date(today.getFullYear(), today.getMonth(), 1)) : openWeek(today))}
          style={styles.link}
        >
          <Feather name="crosshair" size={16} color={colors.accent} />
          <Text style={styles.linkText}>Today</Text>
        </Pressable>
      </View>

      {view === 'month' ? (
        <View>
          <View style={styles.weekRow}>
            {WEEKDAYS.map((d, i) => (
              <Text key={i} style={styles.weekday}>
                {d}
              </Text>
            ))}
          </View>
          {[0, 1, 2, 3, 4, 5].map((row) => (
            <View key={row} style={styles.weekRow}>
              {grid.slice(row * 7, row * 7 + 7).map((d) => {
                const count = onDay(d).length;
                const inMonth = d.getMonth() === anchor.getMonth();
                const isToday = sameDay(d, today);
                return (
                  <Pressable
                    key={d.toISOString()}
                    accessibilityRole="button"
                    accessibilityLabel={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}, ${count} job${count === 1 ? '' : 's'}`}
                    onPress={() => openWeek(d)}
                    style={({ pressed }) => [styles.cell, isToday && styles.cellToday, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={[styles.cellNumber, !inMonth && { color: colors.muted }, isToday && { color: colors.accent }]}>{d.getDate()}</Text>
                    {count > 0 && (
                      <View style={[styles.badge, !inMonth && { opacity: 0.5 }]}>
                        <Text style={styles.badgeText}>{count}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
          <Small color={colors.muted}>Tap a day to see its week.</Small>
        </View>
      ) : (
        <View style={{ gap: 14 }}>
          {Array.from({ length: 7 }, (_, i) => addDays(anchor, i)).map((d) => {
            const dayJobs = onDay(d);
            const isToday = sameDay(d, today);
            return (
              <View key={d.toISOString()} style={{ gap: 8 }}>
                <Text style={[styles.dayLabel, sameDay(d, picked) && { color: colors.text }, isToday && { color: colors.accent }]}>
                  {d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  {isToday ? ' · Today' : ''}
                </Text>
                {dayJobs.length === 0 ? (
                  <Small color={colors.muted}>Nothing planned</Small>
                ) : (
                  dayJobs.map((j) => (
                    <Card key={j.id} onPress={() => router.push({ pathname: '/job/[id]', params: { id: j.id } })} style={styles.jobCard}>
                      <View style={styles.timeCol}>
                        <Text style={styles.time}>{time(j.start)}</Text>
                        {j.end && <Text style={styles.timeEnd}>{time(j.end)}</Text>}
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Strong>{j.title}</Strong>
                        <Small>{[j.client, j.address].filter(Boolean).join(' · ')}</Small>
                      </View>
                      <StatusChip status={j.status} />
                    </Card>
                  ))
                )}
              </View>
            );
          })}
        </View>
      )}

      {ready.length > 0 && (
        <>
          <SectionLabel>Ready to schedule</SectionLabel>
          {ready.map((j) => (
            <Card key={j.id} onPress={() => router.push({ pathname: '/job/[id]', params: { id: j.id } })}>
              <Strong>{j.title}</Strong>
              <Small>{j.client ? `${j.client} · ` : ''}Tap, then “Pick a day and time”</Small>
            </Card>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.display, fontSize: 22, color: colors.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  switchRow: { flexDirection: 'row', gap: 18, justifyContent: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 6 },
  linkText: { fontFamily: fonts.bold, fontSize: 16, color: colors.accent },
  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontFamily: fonts.bold, fontSize: 13, color: colors.muted, paddingVertical: 6 },
  cell: {
    flex: 1,
    aspectRatio: 0.9,
    margin: 2,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  cellToday: { borderWidth: 2, borderColor: colors.accent },
  cellNumber: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { fontFamily: fonts.bold, fontSize: 13, color: colors.onAccent },
  dayLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.textSoft, textTransform: 'uppercase', letterSpacing: 0.8 },
  jobCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  timeCol: { width: 70 },
  time: { fontFamily: fonts.bold, fontSize: 16, color: colors.text },
  timeEnd: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
});
