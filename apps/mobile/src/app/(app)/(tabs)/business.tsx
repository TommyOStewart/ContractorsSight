import { expenseCategoryLabel } from '@contractorsight/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSession } from '../../../auth/SessionProvider';
import { exportExpenses } from '../../../data/exportExpenses';
import { supabase } from '../../../lib/supabase';
import { BigButton, Card, colors, Display, Eyebrow, fonts, IconButton, Message, Screen, Small, Strong } from '../../../ui';
import { BarList, chartColors, ColumnChart, Panel, StatTile } from '../../../ui/charts';

interface Summary {
  year: number;
  paidByMonth: { month: string; cents: number }[];
  owed: { cents: number; invoices: number; oldestIssuedOn: string | null };
  quotesWaiting: { cents: number; count: number; olderThan14Days: number };
  quoteOutcomes90Days: { won: number; lost: number };
  jobsByStatus: Record<string, number>;
  profitByJobType: { jobType: string; jobs: number; paidCents: number; profitCents: number; averagePaidCents: number }[];
  expensesByCategory: { category: string; cents: number; count: number }[];
  expensesTotal: { cents: number; count: number };
  materialsBySupplier: { name: string; cents: number }[];
  missingReceipts: number;
}

const STAGES: [string, string][] = [
  ['lead', 'Lead'],
  ['quoted', 'Quoted'],
  ['accepted', 'Accepted'],
  ['scheduled', 'Scheduled'],
  ['in_progress', 'Working'],
  ['completed', 'Done, not billed'],
  ['invoiced', 'Invoiced'],
];
const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
const shortDollars = (cents: number) => (cents >= 100_000 ? `${+(cents / 100_000).toFixed(1)}k` : dollars(cents));
const monthLabel = (ym: string) => new Date(`${ym}-15T12:00:00`).toLocaleDateString('en-US', { month: 'short' });
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const daysSince = (date: string) => Math.max(0, Math.round((Date.now() - new Date(`${date}T12:00:00`).getTime()) / 86_400_000));
const age = (date: string) => {
  const d = daysSince(date);
  return d === 0 ? 'issued today' : `oldest ${d} day${d === 1 ? '' : 's'}`;
};

export default function BusinessScreen() {
  const { memberships } = useSession();
  const company = memberships[0]!;
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const { data, error } = await supabase.rpc('dashboard_summary', { p_org_id: company.orgId });
        if (error) setError(error.message);
        else setSummary(data as unknown as Summary);
      })();
    }, [company.orgId]),
  );

  async function download() {
    if (!summary) return;
    setExporting(true);
    setExported(null);
    try {
      const n = await exportExpenses(company.orgId, company.orgName, summary.year);
      setExported(`${n} expense${n === 1 ? '' : 's'} exported.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }

  if (error) return <Screen><Message text={error} tone="error" /></Screen>;
  if (!summary)
    return (
      <Screen center>
        <ActivityIndicator size="large" color={colors.accent} />
      </Screen>
    );

  const months = summary.paidByMonth;
  const thisMonth = months.at(-1)?.cents ?? 0;
  const lastMonth = months.at(-2)?.cents ?? 0;
  const change = lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null;
  const decided = summary.quoteOutcomes90Days.won + summary.quoteOutcomes90Days.lost;
  const winRate = decided ? summary.quoteOutcomes90Days.won / decided : null;
  const anyPaid = months.some((m) => m.cents > 0);

  const tiles = (
    <View style={styles.tiles}>
      <StatTile
        label={`Paid in ${new Date().toLocaleDateString('en-US', { month: 'long' })}`}
        value={dollars(thisMonth)}
        sub={change === null ? 'Nothing paid last month' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}% vs last month`}
      />
      <StatTile
        label="Owed to you"
        value={dollars(summary.owed.cents)}
        sub={
          summary.owed.invoices
            ? `${summary.owed.invoices} invoice${summary.owed.invoices === 1 ? '' : 's'}${summary.owed.oldestIssuedOn ? ` · ${age(summary.owed.oldestIssuedOn)}` : ''}`
            : 'All invoices paid'
        }
      />
      <StatTile
        label="Quotes waiting on a yes"
        value={dollars(summary.quotesWaiting.cents)}
        sub={`${summary.quotesWaiting.count} quote${summary.quotesWaiting.count === 1 ? '' : 's'}${summary.quotesWaiting.olderThan14Days ? ` · ${summary.quotesWaiting.olderThan14Days} older than 2 weeks` : ''}`}
      />
      <StatTile
        label="Quotes won, last 90 days"
        value={winRate === null ? '–' : `${Math.round(winRate * 100)}%`}
        meter={winRate ?? undefined}
        sub={decided ? `${summary.quoteOutcomes90Days.won} of ${decided} decided` : 'No quotes decided yet'}
      />
    </View>
  );

  const stageRows = STAGES.map(([key, label]) => ({ label, value: summary.jobsByStatus[key] ?? 0, display: String(summary.jobsByStatus[key] ?? 0) }));
  const profitRows = summary.profitByJobType.map((t) => ({
    label: titleCase(t.jobType),
    sub: `${t.jobs} job${t.jobs === 1 ? '' : 's'} · avg ${dollars(t.averagePaidCents)}`,
    value: Math.max(0, t.profitCents),
    display: dollars(t.profitCents),
  }));

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 4 }}>
          <Eyebrow>{company.orgName}</Eyebrow>
          <Display size={wide ? 44 : 34}>How business is going</Display>
        </View>
        {Platform.OS !== 'web' && <IconButton icon="x" label="Close" onPress={() => router.back()} />}
      </View>

      {tiles}

      <Panel title="Paid, by month" subtitle="Money received, last 12 months">
        {anyPaid ? (
          <ColumnChart
            data={months.map((m) => ({ label: monthLabel(m.month), value: m.cents, display: dollars(m.cents) }))}
            formatAxis={shortDollars}
            height={wide ? 220 : 160}
          />
        ) : (
          <Small color={colors.muted}>No payments recorded yet. Say "Henderson paid by check" after a job and it shows up here.</Small>
        )}
      </Panel>

      <View style={[styles.row, wide && styles.rowWide]}>
        <View style={styles.cell}>
          <Panel title="Jobs by stage" subtitle="Where your open work is sitting">
            <BarList rows={stageRows} color={chartColors.money} empty="No jobs yet." />
          </Panel>
        </View>
        <View style={styles.cell}>
          <Panel title="Where the money's made" subtitle={`Paid minus materials, by type of job, ${summary.year}`}>
            <BarList rows={profitRows} color={chartColors.money} empty="Shows up once jobs are paid." />
          </Panel>
        </View>
      </View>

      <View style={styles.tax}>
        <View style={[styles.taxHead, wide && { flexDirection: 'row', alignItems: 'flex-end' }]}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={styles.taxTitle}>{summary.year} tax year: business expenses</Text>
            <Small color={colors.muted}>Built from your receipts and purchases. Your accountant decides what's deductible.</Small>
          </View>
          <View style={{ minWidth: wide ? 320 : undefined }}>
            <BigButton title="Download for my accountant" icon="download" onPress={() => void download()} busy={exporting} />
          </View>
        </View>
        <Message text={exported} tone="success" />

        <View style={[styles.row, wide && styles.rowWide]}>
          <View style={[styles.cell, { gap: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <Text style={styles.hero}>{dollars(summary.expensesTotal.cents)}</Text>
              <Small color={colors.muted}>
                so far this year · {summary.expensesTotal.count} expense{summary.expensesTotal.count === 1 ? '' : 's'}
              </Small>
            </View>
            <BarList
              rows={summary.expensesByCategory.map((e) => ({
                label: expenseCategoryLabel(e.category),
                sub: `${e.count} purchase${e.count === 1 ? '' : 's'}`,
                value: e.cents,
                display: dollars(e.cents),
              }))}
              color={chartColors.cost}
              empty="No expenses yet. Snap a receipt or say what you bought."
            />
          </View>
          <View style={[styles.cell, { gap: 12 }]}>
            <Strong size={18}>Materials, by supply house</Strong>
            <BarList
              rows={summary.materialsBySupplier.map((s) => ({ label: s.name, value: s.cents, display: dollars(s.cents) }))}
              color={chartColors.cost}
              empty="No materials bought yet this year."
            />
            {summary.missingReceipts > 0 && (
              <Card>
                <Strong size={17}>
                  {summary.missingReceipts} purchase{summary.missingReceipts === 1 ? ' has' : 's have'} no receipt photo
                </Strong>
                <Small>Snap them before they get lost.</Small>
              </Card>
            )}
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  row: { gap: 14 },
  rowWide: { flexDirection: 'row', alignItems: 'flex-start' },
  cell: { flex: 1, minWidth: 0 },
  tax: { borderRadius: 14, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surfaceSunk, padding: 18, gap: 16 },
  taxHead: { gap: 12 },
  taxTitle: { fontFamily: fonts.display, fontSize: 28, color: colors.text, textTransform: 'uppercase', letterSpacing: 0.6 },
  hero: { fontFamily: fonts.display, fontSize: 52, lineHeight: 54, color: colors.text },
});
