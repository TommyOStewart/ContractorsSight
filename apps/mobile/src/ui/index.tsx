import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, statusColors, TOUCH } from './theme';

export { colors, fonts, statusColors, TOUCH } from './theme';
export type IconName = ComponentProps<typeof Feather>['name'];

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Screen({
  children,
  scroll = true,
  center = false,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  center?: boolean;
  /** Pinned to the bottom (primary actions). */
  footer?: ReactNode;
}) {
  const body = scroll ? (
    <ScrollView contentContainerStyle={[styles.content, center && styles.center]} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, styles.flex, center && styles.center]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {body}
        {footer && <View style={styles.footer}>{footer}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** Big condensed uppercase headline. */
export function Display({ children, size = 34, align }: { children: ReactNode; size?: number; align?: 'center' }) {
  return <Text style={[styles.display, { fontSize: size, lineHeight: size * 1.05 }, align && { textAlign: align }]}>{children}</Text>;
}

/** Small uppercase label in the accent (e.g. the company name). */
export function Eyebrow({ children, color = colors.accent }: { children: ReactNode; color?: string }) {
  return <Text style={[styles.eyebrow, { color }]}>{children}</Text>;
}

export function Body({ children, muted, size = 17 }: { children: ReactNode; muted?: boolean; size?: number }) {
  return <Text style={[styles.body, { fontSize: size, lineHeight: size * 1.35 }, muted && { color: colors.muted }]}>{children}</Text>;
}

export function Strong({ children, size = 19 }: { children: ReactNode; size?: number }) {
  return <Text style={[styles.strong, { fontSize: size, lineHeight: size * 1.25 }]}>{children}</Text>;
}

export function Small({ children, color = colors.textSoft }: { children: ReactNode; color?: string }) {
  return <Text style={[styles.small, { color }]}>{children}</Text>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

export function Message({ text, tone }: { text: string | null; tone: 'error' | 'success' }) {
  if (!text) return null;
  return (
    <View style={[styles.message, tone === 'error' ? styles.messageError : styles.messageOk]}>
      <Feather name={tone === 'error' ? 'alert-triangle' : 'check-circle'} size={20} color={tone === 'error' ? colors.danger : colors.success} />
      <Text style={styles.messageText}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function BigButton({
  title,
  onPress,
  icon,
  busy,
  disabled,
}: {
  title: string;
  onPress: () => void;
  icon?: IconName;
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.big, (pressed || off) && styles.pressed, disabled && styles.disabled]}
    >
      {busy ? (
        <ActivityIndicator color={colors.onAccent} />
      ) : (
        <>
          {icon && <Feather name={icon} size={26} color={colors.onAccent} />}
          <Text style={styles.bigText}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function SecondaryButton({ title, onPress, icon, busy }: { title: string; onPress: () => void; icon?: IconName; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, (pressed || busy) && styles.pressed]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <>
          {icon && <Feather name={icon} size={24} color={colors.text} />}
          <Text style={styles.secondaryText}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export function TextButton({ title, onPress, color = colors.muted, busy }: { title: string; onPress: () => void; color?: string; busy?: boolean }) {
  return (
    <Pressable accessibilityRole="button" disabled={busy} onPress={onPress} style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}>
      {busy ? <ActivityIndicator color={color} /> : <Text style={[styles.textButtonText, { color }]}>{title}</Text>}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Feather name={icon} size={24} color={colors.text} />
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        {...input}
        style={[styles.input, input.multiline && styles.multiline]}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Card({
  children,
  onPress,
  tone = 'plain',
  style,
}: {
  children: ReactNode;
  onPress?: () => void;
  tone?: 'plain' | 'accent' | 'danger';
  style?: StyleProp<ViewStyle>;
}) {
  const look = [styles.card, tone === 'accent' && styles.cardAccent, tone === 'danger' && styles.cardDanger, style];
  if (!onPress) return <View style={look}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [...look, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export function StatusChip({ status, label }: { status: string; label?: string }) {
  const c = statusColors[status] ?? statusColors.lead!;
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{label ?? c.label}</Text>
    </View>
  );
}

/** A tappable row with a big checkbox on the right. */
export function CheckRow({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={({ pressed }) => [styles.card, styles.checkRow, !checked && styles.unchecked, pressed && styles.pressed]}
    >
      <View style={styles.flex}>{children}</View>
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>{checked && <Feather name="check" size={22} color={colors.onAccent} />}</View>
    </Pressable>
  );
}

export function Loading() {
  return (
    <View style={[styles.flex, styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: 20, gap: 14 },
  center: { justifyContent: 'center' },
  footer: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20, gap: 6, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surfaceSunk },

  display: { fontFamily: fonts.display, color: colors.text, textTransform: 'uppercase', letterSpacing: 0.5 },
  eyebrow: { fontFamily: fonts.display, fontSize: 15, letterSpacing: 1.8, textTransform: 'uppercase' },
  body: { fontFamily: fonts.body, color: colors.text },
  strong: { fontFamily: fonts.bold, color: colors.text },
  small: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20 },
  sectionLabel: { fontFamily: fonts.bold, fontSize: 14, color: colors.muted, textTransform: 'uppercase', letterSpacing: 1.1, marginTop: 6 },

  message: { flexDirection: 'row', gap: 10, alignItems: 'center', borderRadius: 12, padding: 14, borderWidth: 1 },
  messageError: { backgroundColor: colors.dangerWash, borderColor: colors.danger },
  messageOk: { backgroundColor: '#132A27', borderColor: colors.success },
  messageText: { flex: 1, fontFamily: fonts.medium, fontSize: 16, lineHeight: 21, color: colors.text },

  big: { height: 64, borderRadius: 14, backgroundColor: colors.accent, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  bigText: { fontFamily: fonts.display, fontSize: 24, letterSpacing: 1, textTransform: 'uppercase', color: colors.onAccent },
  secondary: { height: 64, borderRadius: 14, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  secondaryText: { fontFamily: fonts.bold, fontSize: 19, color: colors.text },
  textButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  textButtonText: { fontFamily: fonts.semibold, fontSize: 17 },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  disabled: { backgroundColor: colors.borderStrong },

  field: { gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 16, color: colors.textSoft },
  input: {
    minHeight: TOUCH,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  multiline: { minHeight: 160, textAlignVertical: 'top' },

  card: { borderRadius: 14, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, gap: 4 },
  cardAccent: { backgroundColor: colors.accentWash, borderColor: colors.accent },
  cardDanger: { backgroundColor: colors.dangerWash, borderColor: colors.danger },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  chipText: { fontFamily: fonts.bold, fontSize: 13, letterSpacing: 0.8, textTransform: 'uppercase' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72 },
  unchecked: { opacity: 0.55 },
  checkbox: { width: 34, height: 34, borderRadius: 8, borderWidth: 2, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
