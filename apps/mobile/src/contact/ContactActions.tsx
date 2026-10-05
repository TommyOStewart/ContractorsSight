import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, SecondaryButton } from '../ui';

// Calls and texts go through the phone's own Dialer and Messages apps, so replies land where the
// contractor already reads them. Nothing here sends anything by itself.

const dial = (phone: string) => phone.replace(/[^\d+]/g, '');

export function callPhone(phone: string) {
  void Linking.openURL(`tel:${dial(phone)}`);
}

/** Opens Messages with the text filled in; the contractor still presses send. */
export function textPhone(phone: string, body = '') {
  // iOS separates the body with "&", Android with "?".
  const sep = Platform.OS === 'ios' ? '&' : '?';
  void Linking.openURL(`sms:${dial(phone)}${body ? `${sep}body=${encodeURIComponent(body)}` : ''}`);
}

export function openDirections(address: string) {
  void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`);
}

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Ready-made texts. The first name keeps them from sounding like a robot. */
function templates(name: string, owedCents?: number) {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const hi = first ? `Hi ${first}, ` : 'Hi, ';
  return [
    { label: 'On my way', body: `${hi}on my way now.` },
    { label: 'Running late', body: `${hi}running about 15 minutes behind. Sorry about that.` },
    { label: 'Job done', body: `${hi}all done for today. Let me know if you have any questions.` },
    ...(owedCents && owedCents > 0
      ? [{ label: `Payment reminder`, body: `${hi}friendly reminder that ${money(owedCents)} is still open on your invoice. Thanks!` }]
      : []),
    { label: 'Blank text', body: '' },
  ];
}

/** Call / Text / Directions for a customer, with one-tap text messages. */
export function ContactActions({ name, phone, address, owedCents }: { name: string; phone: string | null; address: string | null; owedCents?: number }) {
  const [picking, setPicking] = useState(false);
  if (!phone && !address) return null;
  return (
    <View style={{ gap: 10 }}>
      <View style={styles.row}>
        {phone && (
          <View style={styles.cell}>
            <SecondaryButton title="Call" icon="phone" onPress={() => callPhone(phone)} />
          </View>
        )}
        {phone && (
          <View style={styles.cell}>
            <SecondaryButton title={picking ? 'Close' : 'Text'} icon={picking ? 'x' : 'message-square'} onPress={() => setPicking((p) => !p)} />
          </View>
        )}
        {address && (
          <View style={styles.cell}>
            <SecondaryButton title="Map" icon="navigation" onPress={() => openDirections(address)} />
          </View>
        )}
      </View>
      {picking && phone && (
        <View style={styles.templates}>
          {templates(name, owedCents).map((t) => (
            <Pressable
              key={t.label}
              accessibilityRole="button"
              accessibilityHint={t.body || 'Opens Messages'}
              onPress={() => {
                setPicking(false);
                textPhone(phone, t.body);
              }}
              style={({ pressed }) => [styles.template, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.templateLabel}>{t.label}</Text>
              {!!t.body && (
                <Text style={styles.templateBody} numberOfLines={2}>
                  {t.body}
                </Text>
              )}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  cell: { flex: 1 },
  templates: { gap: 8 },
  template: { borderRadius: 12, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, padding: 14, gap: 2 },
  templateLabel: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  templateBody: { fontFamily: fonts.body, fontSize: 14, color: colors.textSoft },
});
