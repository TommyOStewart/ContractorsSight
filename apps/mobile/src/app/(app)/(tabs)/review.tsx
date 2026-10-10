import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { usePending } from '../../../data/PendingProvider';
import { captureErrorMessage } from '../../../lib/worker';
import { Body, Card, colors, Display, Screen, Small, Strong } from '../../../ui';

const SOURCE: Record<string, { icon: 'mic' | 'camera' | 'type'; label: string }> = {
  audio: { icon: 'mic', label: 'Voice note' },
  image: { icon: 'camera', label: 'Photo' },
  text: { icon: 'type', label: 'Typed note' },
};

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ReviewListScreen() {
  const { items, inFlight, refresh } = usePending();
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <Screen>
      <Display>Check these</Display>
      {inFlight.map((c) => {
        const source = SOURCE[c.captureType] ?? SOURCE.text!;
        return c.status === 'processing' ? (
          <Card key={c.id} style={styles.working}>
            <ActivityIndicator color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Strong size={17}>Working on your {source.label.toLowerCase()}…</Strong>
              <Small color={colors.muted}>It'll show up here in a few seconds. You can leave the app.</Small>
            </View>
          </Card>
        ) : (
          <Card key={c.id} tone="danger">
            <Strong size={17}>Couldn't finish your {source.label.toLowerCase()}</Strong>
            <Small>{captureErrorMessage(c.error)}</Small>
          </Card>
        );
      })}
      {items.length === 0 && inFlight.length === 0 ? (
        <Card>
          <Strong>All caught up</Strong>
          <Body muted>Nothing is waiting. New notes show up here after you talk, type, or snap a photo.</Body>
        </Card>
      ) : (
        items.map((item) => {
          const source = SOURCE[item.captureType] ?? SOURCE.text!;
          return (
            <Card key={item.id} onPress={() => router.push(`/review/${item.id}`)} tone={item.questionCount ? 'accent' : 'plain'}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Feather name={source.icon} size={16} color={colors.muted} />
                <Small color={colors.muted}>
                  {source.label} · {ago(item.createdAt)}
                </Small>
              </View>
              <Strong size={18}>{item.text.length > 120 ? `${item.text.slice(0, 117)}…` : item.text}</Strong>
              <Small>
                {item.changeCount} change{item.changeCount === 1 ? '' : 's'}
                {item.questionCount ? ` · ${item.questionCount} question${item.questionCount === 1 ? '' : 's'} for you` : ''}
              </Small>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  working: { flexDirection: 'row', alignItems: 'center', gap: 14 },
});
