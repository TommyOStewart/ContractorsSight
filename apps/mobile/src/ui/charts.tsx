import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from './theme';

// Chart colors, validated against the dark surface (lightness band, CVD, contrast):
// money in = orange, costs = teal, context = gray. One measure per chart, every bar labeled.
export const chartColors = {
  money: '#E8650E',
  cost: '#26A090',
  context: '#6B7079',
  track: '#2C3036',
  grid: '#2C3036',
} as const;

export function Panel({ title, subtitle, children, right }: { title: string; subtitle?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.panelTitle}>{title}</Text>
          {subtitle && <Text style={styles.panelSub}>{subtitle}</Text>}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function StatTile({ label, value, sub, meter }: { label: string; value: string; sub?: string; meter?: number }) {
  return (
    <View style={[styles.panel, styles.tile]}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      {meter !== undefined && (
        <View style={styles.meterTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(meter * 100) }}>
          <View style={[styles.meterFill, { width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%` }]} />
        </View>
      )}
      {sub && <Text style={styles.tileSub}>{sub}</Text>}
    </View>
  );
}

export interface ColumnDatum {
  label: string;
  value: number;
  display: string;
}

/**
 * Columns over time, one series. The latest column is emphasized; hovering or tapping a column
 * moves the emphasis and the readout to it.
 */
export function ColumnChart({ data, height = 200, formatAxis }: { data: ColumnDatum[]; height?: number; formatAxis: (v: number) => string }) {
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? data.length - 1;
  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  // Halves of a "nice" max keep every gridline label round ($1k / $500 / $0).
  const ticks = [max, max / 2, 0];

  return (
    <View style={{ gap: 10 }}>
      <Text style={styles.readout} accessibilityLiveRegion="polite">
        <Text style={{ fontFamily: fonts.bold }}>{data[shown]?.label}</Text> {data[shown]?.display}
      </Text>
      <View style={{ flexDirection: 'row', height: height + 28 }}>
        <View style={{ width: 48, height }}>
          {ticks.map((t) => (
            <Text key={t} style={[styles.axisLabel, { position: 'absolute', right: 6, top: height - (t / max) * height - 8 }]}>
              {formatAxis(t)}
            </Text>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          {ticks.map((t) => (
            <View key={t} style={[styles.gridLine, { top: height - (t / max) * height }, t === 0 && { backgroundColor: '#4A4F57' }]} />
          ))}
          <View style={{ flexDirection: 'row', gap: 2, height: height + 28 }}>
            {data.map((d, i) => (
              <Pressable
                key={d.label}
                accessibilityRole="button"
                accessibilityLabel={`${d.label}: ${d.display}`}
                onHoverIn={() => setActive(i)}
                onHoverOut={() => setActive(null)}
                onPress={() => setActive(i)}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}
              >
                <View
                  style={{
                    width: '70%',
                    maxWidth: 44,
                    height: Math.max(d.value > 0 ? 3 : 0, (d.value / max) * height),
                    backgroundColor: i === shown ? chartColors.money : chartColors.context,
                    borderTopLeftRadius: 4,
                    borderTopRightRadius: 4,
                  }}
                />
                <Text style={[styles.axisLabel, { height: 28, lineHeight: 28 }, i === shown && { color: colors.text }]}>{d.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

export interface BarRow {
  label: string;
  sub?: string;
  value: number;
  display: string;
}

/** Labeled horizontal bars, longest = full width. */
export function BarList({ rows, color, empty }: { rows: BarRow[]; color: string; empty: string }) {
  if (!rows.length) return <Text style={styles.panelSub}>{empty}</Text>;
  const top = Math.max(...rows.map((r) => r.value), 1);
  return (
    <View style={{ gap: 10 }}>
      {rows.map((r) => (
        <View key={r.label} style={styles.barRow} accessible accessibilityLabel={`${r.label}: ${r.display}`}>
          <View style={styles.barLabel}>
            <Text style={styles.barLabelText} numberOfLines={1}>
              {r.label}
            </Text>
            {r.sub && <Text style={styles.barSub} numberOfLines={1}>{r.sub}</Text>}
          </View>
          <View style={styles.barTrack}>
            <View style={{ width: `${Math.max(2, (r.value / top) * 100)}%`, backgroundColor: color, borderTopRightRadius: 4, borderBottomRightRadius: 4 }} />
          </View>
          <Text style={styles.barValue}>{r.display}</Text>
        </View>
      ))}
    </View>
  );
}

/** Round a max up to 1, 2, 4, 5 × 10^n so the axis halves read cleanly. */
function niceMax(v: number): number {
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 4, 5, 10]) if (step * exp >= v) return step * exp;
  return 10 * exp;
}

const styles = StyleSheet.create({
  panel: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 18, gap: 14 },
  panelHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  panelTitle: { fontFamily: fonts.display, fontSize: 24, color: colors.text, textTransform: 'uppercase', letterSpacing: 0.6 },
  panelSub: { fontFamily: fonts.body, fontSize: 15, color: colors.muted, lineHeight: 20 },
  tile: { gap: 6, flexGrow: 1, flexBasis: 220 },
  tileLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.muted },
  tileValue: { fontFamily: fonts.display, fontSize: 44, lineHeight: 46, color: colors.text },
  tileSub: { fontFamily: fonts.body, fontSize: 15, color: colors.textSoft },
  meterTrack: { height: 10, borderRadius: 5, backgroundColor: '#3A3F46', overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 5, backgroundColor: chartColors.money },
  readout: { fontFamily: fonts.body, fontSize: 17, color: colors.textSoft },
  axisLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: chartColors.grid },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  barLabel: { width: 150 },
  barLabelText: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  barSub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  barTrack: { flex: 1, height: 18, borderRadius: 4, backgroundColor: chartColors.track, overflow: 'hidden', flexDirection: 'row' },
  barValue: { width: 84, textAlign: 'right', fontFamily: fonts.bold, fontSize: 16, color: colors.text },
});
