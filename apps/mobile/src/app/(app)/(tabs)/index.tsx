import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../../auth/SessionProvider';
import { usePending } from '../../../data/PendingProvider';
import { Body, colors, Display, Eyebrow, fonts, Screen, SecondaryButton, Small } from '../../../ui';

const initials = (email?: string) => (email ?? '?').slice(0, 2).toUpperCase();

export default function CaptureScreen() {
  const { session, memberships } = useSession();
  const { items } = usePending();
  const company = memberships[0]!;
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <View style={{ gap: 2 }}>
          <Eyebrow>{company.orgName}</Eyebrow>
          <Small color={colors.muted}>{today}</Small>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Account" onPress={() => router.push('/account')} style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(session?.user.email)}</Text>
        </Pressable>
      </View>

      {items.length > 0 && (
        <Pressable accessibilityRole="button" onPress={() => router.push('/review')} style={({ pressed }) => [styles.banner, pressed && { opacity: 0.8 }]}>
          <View style={styles.bannerCount}>
            <Text style={styles.bannerCountText}>{items.length}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>{items.length === 1 ? 'Note ready to check' : 'Notes ready to check'}</Text>
            <Small>Tap to review and save</Small>
          </View>
          <Feather name="chevron-right" size={26} color={colors.accent} />
        </Pressable>
      )}

      <View style={styles.middle}>
        <Display size={40} align="center">
          What happened?
        </Display>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Talk"
          onPress={() => router.push('/record')}
          style={({ pressed }) => [styles.mic, pressed && { transform: [{ scale: 0.97 }] }]}
        >
          <Feather name="mic" size={72} color={colors.onAccent} />
          <Text style={styles.micText}>Tap to talk</Text>
        </Pressable>
        <View style={{ maxWidth: 300 }}>
          <Body muted>Say it like you'd tell the office. We'll sort it into the right jobs.</Body>
        </View>
      </View>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <SecondaryButton title="Photo" icon="camera" onPress={() => router.push('/photo')} />
        </View>
        <View style={{ flex: 1 }}>
          <SecondaryButton title="Type" icon="type" onPress={() => router.push('/type')} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.text },
  banner: { minHeight: 64, borderRadius: 14, borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentWash, flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  bannerCount: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  bannerCountText: { fontFamily: fonts.display, fontSize: 20, color: colors.onAccent },
  bannerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 },
  mic: {
    width: 212,
    height: 212,
    borderRadius: 106,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 14,
    borderColor: colors.accentWash,
  },
  micText: { fontFamily: fonts.display, fontSize: 24, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.onAccent },
  row: { flexDirection: 'row', gap: 12 },
});
