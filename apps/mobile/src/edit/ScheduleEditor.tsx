import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BigButton, colors, fonts, Message, TextButton } from '../ui';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** "8", "8:30", "830" → hours and minutes on a 12-hour clock. */
function parseClock(raw: string): { h: number; m: number } | null {
  const match = /^(\d{1,2})(?::?(\d{2}))?$/.exec(raw.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2] ?? 0);
  return h >= 1 && h <= 12 && m < 60 ? { h, m } : null;
}

/**
 * Pick a day, a start time and how long. Times are the phone's local time; the worker gets an
 * exact instant (ISO with offset), so it lands right whatever timezone the worker runs in.
 */
export function ScheduleEditor({
  start,
  end,
  onSave,
  onCancel,
}: {
  start: string | null;
  end: string | null;
  onSave: (startIso: string, endIso: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const initial = start ? new Date(start) : null;
  const [day, setDay] = useState(initial ? ymd(initial) : ymd(addDays(new Date(), 1)));
  const [clock, setClock] = useState(initial ? `${initial.getHours() % 12 || 12}:${pad(initial.getMinutes())}` : '8:00');
  const [pm, setPm] = useState(initial ? initial.getHours() >= 12 : false);
  const [hours, setHours] = useState(initial && end ? String(+((new Date(end).getTime() - initial.getTime()) / 3600_000).toFixed(2)) : '2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
    const time = parseClock(clock);
    const length = Number(hours);
    if (!date) return setError('Day should look like 2026-10-14.');
    if (!time) return setError('Start time should look like 8:00.');
    if (!(length > 0 && length <= 24)) return setError('How long should be a number of hours, like 2 or 1.5.');
    const startAt = new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3]), (time.h % 12) + (pm ? 12 : 0), time.m);
    const endAt = new Date(startAt.getTime() + length * 3600_000);
    setBusy(true);
    setError(null);
    const problem = await onSave(startAt.toISOString(), endAt.toISOString());
    setBusy(false);
    if (problem) setError(problem);
  }

  const today = new Date();
  const quickDays = [0, 1, 2, 3, 4, 5, 6].map((n) => addDays(today, n));

  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.label}>Day</Text>
      <View style={styles.chips}>
        {quickDays.map((d, i) => {
          const value = ymd(d);
          const on = value === day;
          return (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setDay(value)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput value={day} onChangeText={setDay} accessibilityLabel="Day (year-month-day)" keyboardType="numbers-and-punctuation" style={styles.input} />

      <Text style={styles.label}>Start</Text>
      <View style={styles.row}>
        <TextInput
          value={clock}
          onChangeText={setClock}
          accessibilityLabel="Start time"
          keyboardType="numbers-and-punctuation"
          style={[styles.input, { flex: 1 }]}
        />
        {(['AM', 'PM'] as const).map((label) => {
          const on = (label === 'PM') === pm;
          return (
            <Pressable
              key={label}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => setPm(label === 'PM')}
              style={[styles.ampm, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>How long (hours)</Text>
      <TextInput value={hours} onChangeText={setHours} accessibilityLabel="How long, in hours" keyboardType="decimal-pad" style={styles.input} />

      <Message text={error} tone="error" />
      <BigButton title={start ? 'Reschedule' : 'Schedule'} icon="calendar" onPress={() => void save()} busy={busy} />
      <TextButton title="Cancel" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textSoft },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 2, borderColor: colors.borderStrong, justifyContent: 'center' },
  ampm: { minHeight: 52, minWidth: 64, borderRadius: 12, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
  chipTextOn: { fontFamily: fonts.bold, color: colors.onAccent },
  input: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceSunk,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 18,
    paddingHorizontal: 14,
  },
});
