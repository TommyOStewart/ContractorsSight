import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSession } from '../../../auth/SessionProvider';
import { callPhone } from '../../../contact/ContactActions';
import { supabase } from '../../../lib/supabase';
import { Body, Card, colors, Display, fonts, Screen, Small, Strong } from '../../../ui';

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  activeJobs: number;
  totalJobs: number;
  /** Billed but not yet paid, across all their invoices. */
  owedCents: number;
  /** Most recent job activity, for sorting. */
  lastActivity: string;
}

type Filter = 'recent' | 'owes' | 'az';
const CLOSED = new Set(['paid', 'declined', 'cancelled']);
const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

export default function CustomersScreen() {
  const { memberships } = useSession();
  const orgId = memberships[0]!.orgId;
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('recent');

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const { data } = await supabase
          .from('clients')
          .select('id, name, phone, created_at, sites (line1, city), jobs (status, updated_at, invoices (status, total_cents, payments (amount_cents)))')
          .eq('org_id', orgId)
          .limit(500);
        setCustomers(
          (data ?? []).map((c) => {
            const jobs = c.jobs ?? [];
            const site = c.sites?.[0];
            return {
              id: c.id,
              name: c.name,
              phone: c.phone,
              address: site ? [site.line1, site.city].filter(Boolean).join(', ') : null,
              activeJobs: jobs.filter((j) => !CLOSED.has(j.status)).length,
              totalJobs: jobs.length,
              owedCents: jobs
                .flatMap((j) => j.invoices ?? [])
                .filter((i) => i.status === 'sent' || i.status === 'draft')
                .reduce((sum, i) => sum + Number(i.total_cents) - (i.payments ?? []).reduce((p, x) => p + Number(x.amount_cents), 0), 0),
              lastActivity: jobs.reduce((latest, j) => (j.updated_at > latest ? j.updated_at : latest), c.created_at),
            };
          }),
        );
      })();
    }, [orgId]),
  );

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const digits = query.replace(/\D/g, '');
    return customers
      .filter((c) => filter !== 'owes' || c.owedCents > 0)
      .filter(
        (c) =>
          words.every((w) => `${c.name} ${c.address ?? ''}`.toLowerCase().includes(w)) ||
          (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)),
      )
      .sort((a, b) =>
        filter === 'az' ? a.name.localeCompare(b.name) : filter === 'owes' ? b.owedCents - a.owedCents : b.lastActivity.localeCompare(a.lastActivity),
      );
  }, [customers, query, filter]);

  const totalOwed = customers.reduce((sum, c) => sum + Math.max(0, c.owedCents), 0);

  return (
    <Screen>
      <Display>Customers</Display>
      <View style={styles.search}>
        <Feather name="search" size={22} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Name, street, or phone"
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          accessibilityLabel="Search customers"
          style={styles.searchInput}
          returnKeyType="search"
        />
      </View>
      <View style={styles.filters}>
        {(
          [
            ['recent', 'Recent'],
            ['owes', totalOwed > 0 ? `Owe ${money(totalOwed)}` : 'Owe money'],
            ['az', 'A–Z'],
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

      {shown.length === 0 && (
        <Card>
          <Strong>No customers here</Strong>
          <Body muted>
            {query ? 'Nothing matches that search.' : filter === 'owes' ? 'Nobody owes you money right now.' : 'Customers you talk about show up here once you save them.'}
          </Body>
        </Card>
      )}
      {shown.map((c) => (
        <Card key={c.id} onPress={() => router.push({ pathname: '/customer/[id]', params: { id: c.id } })}>
          <View style={styles.row}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(c.name)}</Text>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Strong>{c.name}</Strong>
              {c.address && <Small>{c.address}</Small>}
              <Small color={c.owedCents > 0 ? colors.accent : colors.muted}>
                {[
                  c.owedCents > 0 ? `Owes ${money(c.owedCents)}` : null,
                  c.activeJobs ? `${c.activeJobs} active job${c.activeJobs === 1 ? '' : 's'}` : `${c.totalJobs} job${c.totalJobs === 1 ? '' : 's'}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Small>
            </View>
            {c.phone && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Call ${c.name}`}
                hitSlop={8}
                onPress={() => callPhone(c.phone!)}
                style={({ pressed }) => [styles.callButton, pressed && { opacity: 0.7 }]}
              >
                <Feather name="phone" size={22} color={colors.accent} />
              </Pressable>
            )}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

const styles = StyleSheet.create({
  search: { height: 58, borderRadius: 14, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 18, height: '100%' },
  filters: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { minHeight: 46, paddingHorizontal: 18, borderRadius: 23, borderWidth: 2, borderColor: colors.borderStrong, justifyContent: 'center' },
  pillOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
  pillTextOn: { fontFamily: fonts.bold, color: colors.onAccent },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceSunk, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.display, fontSize: 19, color: colors.text, letterSpacing: 0.5 },
  callButton: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
