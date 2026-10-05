import { EXPENSE_CATEGORIES, JOB_STATUSES, MATERIAL_STATUSES, PAYMENT_METHODS } from '@contractorsight/shared';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { BigButton, colors, fonts, Message, statusColors, TextButton } from '../ui';

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Path = (string | number)[];
type Kind = 'text' | 'multiline' | 'number' | 'money' | 'date' | 'choice';

interface FieldSpec {
  label: string;
  kind: Kind;
  options?: readonly string[];
  optionLabel?: (v: string) => string;
}

const CATEGORY_LABEL: Record<string, string> = {
  materials: 'Materials',
  tools_equipment: 'Tools',
  vehicle: 'Vehicle',
  supplies: 'Supplies',
  phone_software: 'Phone & software',
  other: 'Other',
};

/** Fields a contractor can sensibly fix by hand. IDs and links stay as the planner resolved them. */
const FIELDS: Record<string, FieldSpec> = {
  name: { label: 'Name', kind: 'text' },
  title: { label: 'Title', kind: 'text' },
  description: { label: 'Description', kind: 'text' },
  body: { label: 'Note', kind: 'multiline' },
  notes: { label: 'Notes', kind: 'multiline' },
  phone: { label: 'Phone', kind: 'text' },
  email: { label: 'Email', kind: 'text' },
  line1: { label: 'Street', kind: 'text' },
  city: { label: 'City', kind: 'text' },
  postalCode: { label: 'ZIP', kind: 'text' },
  quantity: { label: 'Quantity', kind: 'number' },
  hours: { label: 'Hours', kind: 'number' },
  unit: { label: 'Unit', kind: 'text' },
  unitCostDollars: { label: 'Cost each ($)', kind: 'money' },
  unitPriceDollars: { label: 'Price each ($)', kind: 'money' },
  hourlyRateDollars: { label: 'Rate per hour ($)', kind: 'money' },
  totalDollars: { label: 'Total ($)', kind: 'money' },
  amountDollars: { label: 'Amount ($)', kind: 'money' },
  vendorName: { label: 'Store', kind: 'text' },
  reference: { label: 'Check / reference #', kind: 'text' },
  dueInDays: { label: 'Due in (days)', kind: 'number' },
  purchasedOn: { label: 'Date (YYYY-MM-DD)', kind: 'date' },
  spentOn: { label: 'Date (YYYY-MM-DD)', kind: 'date' },
  paidOn: { label: 'Date paid (YYYY-MM-DD)', kind: 'date' },
  validUntil: { label: 'Valid until (YYYY-MM-DD)', kind: 'date' },
  toStatus: { label: 'New status', kind: 'choice', options: JOB_STATUSES, optionLabel: (v) => statusColors[v]?.label ?? v },
  status: { label: 'Status', kind: 'choice', options: MATERIAL_STATUSES },
  category: { label: 'Category', kind: 'choice', options: EXPENSE_CATEGORIES, optionLabel: (v) => CATEGORY_LABEL[v] ?? v },
  method: { label: 'Paid by', kind: 'choice', options: PAYMENT_METHODS },
};

const GROUP_LABEL: Record<string, string> = { lineItems: 'Line', lines: 'Line', changes: 'Changes', siteAddress: 'Address' };

interface Field extends FieldSpec {
  path: Path;
  group?: string;
}

/** Every editable field present in the args, in order, with nested lines and changes flattened. */
function collectFields(value: unknown, path: Path = [], group?: string): Field[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => collectFields(item, [...path, i], `${group ?? 'Line'} ${i + 1}`));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Args).flatMap(([key, v]) => {
    if (v && typeof v === 'object') return collectFields(v, [...path, key], GROUP_LABEL[key] ?? group);
    const spec = FIELDS[key];
    return spec ? [{ ...spec, path: [...path, key], group }] : [];
  });
}

const keyOf = (p: Path) => p.join('.');
const getAt = (obj: Args, p: Path) => p.reduce<any>((o, k) => (o == null ? o : o[k]), obj); // eslint-disable-line @typescript-eslint/no-explicit-any

function setAt(obj: Args, p: Path, value: unknown): Args {
  const copy: Args = structuredClone(obj);
  let node: Args = copy;
  for (const k of p.slice(0, -1)) node = node[k as string];
  const last = p.at(-1)!;
  if (value === undefined) delete node[last as string];
  else node[last as string] = value;
  return copy;
}

export function OperationEditor({
  args,
  onSave,
  onCancel,
}: {
  args: Args;
  onSave: (next: Args) => Promise<string | null>;
  onCancel: () => void;
}) {
  const fields = useMemo(() => collectFields(args), [args]);
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [keyOf(f.path), String(getAt(args, f.path) ?? '')])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!fields.length) {
    return (
      <View style={{ gap: 8 }}>
        <Text style={styles.hint}>Nothing here to type in. Use "Fix it by talking" instead.</Text>
        <TextButton title="Close" onPress={onCancel} />
      </View>
    );
  }

  async function save() {
    let next = args;
    for (const f of fields) {
      const raw = (drafts[keyOf(f.path)] ?? '').trim();
      if (f.kind === 'number' || f.kind === 'money') {
        const n = Number(raw.replace(/[$,]/g, ''));
        if (raw === '' || Number.isNaN(n)) {
          setError(`${f.label} needs a number.`);
          return;
        }
        next = setAt(next, f.path, n);
      } else {
        // An emptied optional field is removed; required ones are caught by validation.
        next = setAt(next, f.path, raw === '' ? undefined : raw);
      }
    }
    setBusy(true);
    setError(null);
    const problem = await onSave(next);
    setBusy(false);
    if (problem) setError(problem);
  }

  let lastGroup: string | undefined;
  return (
    <View style={{ gap: 12 }}>
      {fields.map((f) => {
        const k = keyOf(f.path);
        const header = f.group && f.group !== lastGroup ? f.group : null;
        lastGroup = f.group;
        return (
          <View key={k} style={{ gap: 6 }}>
            {header && <Text style={styles.group}>{header}</Text>}
            <Text style={styles.label}>{f.label}</Text>
            {f.kind === 'choice' ? (
              <View style={styles.choices}>
                {f.options!.map((o) => {
                  const on = drafts[k] === o;
                  return (
                    <Pressable
                      key={o}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      onPress={() => setDrafts((d) => ({ ...d, [k]: o }))}
                      style={[styles.choice, on && styles.choiceOn]}
                    >
                      <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{f.optionLabel ? f.optionLabel(o) : o.replace('_', ' ')}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <TextInput
                value={drafts[k]}
                onChangeText={(t) => setDrafts((d) => ({ ...d, [k]: t }))}
                multiline={f.kind === 'multiline'}
                keyboardType={f.kind === 'number' || f.kind === 'money' ? 'decimal-pad' : f.kind === 'date' ? 'numbers-and-punctuation' : 'default'}
                placeholderTextColor={colors.muted}
                selectionColor={colors.accent}
                style={[styles.input, f.kind === 'multiline' && { minHeight: 100, textAlignVertical: 'top' }]}
              />
            )}
          </View>
        );
      })}
      <Message text={error} tone="error" />
      <BigButton title="Save edit" icon="check" onPress={() => void save()} busy={busy} />
      <TextButton title="Cancel" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  group: { fontFamily: fonts.bold, fontSize: 14, color: colors.accent, textTransform: 'uppercase', letterSpacing: 1, marginTop: 4 },
  label: { fontFamily: fonts.semibold, fontSize: 15, color: colors.textSoft },
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
    paddingVertical: 12,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 2, borderColor: colors.borderStrong, justifyContent: 'center' },
  choiceOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  choiceText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text, textTransform: 'capitalize' },
  choiceTextOn: { color: colors.onAccent, fontFamily: fonts.bold },
});
