import type { ReactNode } from 'react';
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
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Minimal shared UI. Colors are always explicit: unset colors follow the Android system
// theme and can render white-on-white in dark mode.
export const colors = {
  background: '#ffffff',
  surface: '#f3f4f6',
  border: '#d1d5db',
  text: '#111827',
  muted: '#4b5563',
  primary: '#1d4ed8',
  primaryText: '#ffffff',
  danger: '#b91c1c',
  success: '#047857',
} as const;

export function Screen({ children, align = 'center' }: { children: ReactNode; align?: 'center' | 'top' }) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.content, align === 'top' && styles.top]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted]}>{children}</Text>;
}

export function Message({ text, tone }: { text: string | null; tone: 'error' | 'success' }) {
  if (!text) return null;
  return <Text style={[styles.body, { color: tone === 'error' ? colors.danger : colors.success }]}>{text}</Text>;
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} {...input} style={[styles.input, input.multiline && styles.multiline]} />
    </View>
  );
}

export function Card({ children, onPress, tone = 'plain' }: { children: ReactNode; onPress?: () => void; tone?: 'plain' | 'question' | 'warning' }) {
  const style = [styles.card, tone === 'question' && styles.cardQuestion, tone === 'warning' && styles.cardWarning];
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [...style, pressed && styles.pressed]}>
      {children}
    </Pressable>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return <Text style={styles.heading}>{children}</Text>;
}

export function Small({ children }: { children: ReactNode }) {
  return <Text style={styles.small}>{children}</Text>;
}

export function Button({
  title,
  onPress,
  busy,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  variant?: 'primary' | 'link';
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [primary ? styles.button : styles.link, (pressed || busy) && styles.pressed]}
    >
      {busy ? (
        <ActivityIndicator color={primary ? colors.primaryText : colors.primary} />
      ) : (
        <Text style={primary ? styles.buttonText : styles.linkText}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 },
  top: { justifyContent: 'flex-start' },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  body: { color: colors.text, fontSize: 16, lineHeight: 22 },
  muted: { color: colors.muted },
  field: { gap: 6 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  input: {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 50,
    justifyContent: 'center',
  },
  buttonText: { color: colors.primaryText, fontSize: 16, fontWeight: '600' },
  link: { paddingVertical: 10, alignItems: 'center' },
  linkText: { color: colors.primary, fontSize: 16, fontWeight: '500' },
  pressed: { opacity: 0.7 },
  card: { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 14, gap: 4 },
  cardQuestion: { backgroundColor: '#fffbeb', borderColor: '#f59e0b' },
  cardWarning: { backgroundColor: '#fef2f2', borderColor: colors.danger },
  heading: { color: colors.text, fontSize: 18, fontWeight: '700', marginTop: 8 },
  small: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
});
