import { Feather } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { usePending } from '../../data/PendingProvider';
import { supabase } from '../../lib/supabase';
import { worker, WorkerError } from '../../lib/worker';
import { Body, colors, Display, fonts, Message, Screen, SecondaryButton, TextButton } from '../../ui';

const MAX_MS = 3 * 60_000;
const BARS = 14;

type Phase = 'starting' | 'recording' | 'sending' | 'error' | 'no-permission';

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export default function RecordScreen() {
  const { memberships } = useSession();
  const { refresh } = usePending();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<Phase>('starting');
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.08));
  const finishing = useRef(false);

  async function start() {
    setError(null);
    setPhase('starting');
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      setPhase('no-permission');
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    finishing.current = false;
    setPhase('recording');
  }

  useEffect(() => {
    void start();
    return () => {
      if (recorder.isRecording) void recorder.stop();
    };
    // Start once when the screen opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live level meter: metering is in dBFS (about -60 quiet … 0 loud).
  useEffect(() => {
    if (phase !== 'recording') return;
    const db = state.metering ?? -60;
    const level = Math.min(1, Math.max(0.08, (db + 60) / 60));
    setLevels((prev) => [...prev.slice(1), level]);
  }, [state.metering, phase]);

  useEffect(() => {
    if (phase === 'recording' && state.durationMillis >= MAX_MS) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.durationMillis, phase]);

  async function finish() {
    if (finishing.current) return;
    finishing.current = true;
    setPhase('sending');
    try {
      await recorder.stop();
      if (!recorder.uri) throw new Error('The recording was empty.');
      const orgId = memberships[0]!.orgId;
      // Upload first so the recording is kept even if processing fails.
      const path = `${orgId}/${Crypto.randomUUID()}.m4a`;
      const bytes = await new File(recorder.uri).bytes();
      const { error: uploadError } = await supabase.storage.from('captures').upload(path, bytes, { contentType: 'audio/mp4' });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      const result = await worker.createAudioCapture({ orgId, audioPath: path });
      void refresh();
      if (result.changeSetId) router.replace(`/review/${result.changeSetId}`);
      else {
        setError(result.summary ?? 'Nothing to record in that note.');
        setPhase('error');
      }
    } catch (e) {
      setError(e instanceof WorkerError || e instanceof Error ? e.message : 'Something went wrong sending that note.');
      setPhase('error');
    }
  }

  async function cancel() {
    finishing.current = true;
    if (recorder.isRecording) await recorder.stop();
    router.back();
  }

  if (phase === 'no-permission') {
    return (
      <Screen center>
        <Display size={32}>Microphone is off</Display>
        <Body muted>ContractorSight needs the microphone to take voice notes. Turn it on in Settings, then try again.</Body>
        <SecondaryButton title="Open Settings" icon="settings" onPress={() => void Linking.openSettings()} />
        <TextButton title="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  const recording = phase === 'recording' || phase === 'starting';
  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <View style={styles.live}>
          {phase === 'recording' && <View style={styles.dot} />}
          <Text style={[styles.liveText, phase !== 'recording' && { color: colors.muted }]}>
            {phase === 'sending' ? 'Writing it up' : phase === 'error' ? 'Stopped' : 'Listening'}
          </Text>
        </View>
        <Text style={styles.timer}>{clock(state.durationMillis)}</Text>
      </View>

      <View style={styles.meter} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {levels.map((level, i) => (
          <View key={i} style={[styles.bar, { height: 12 + level * 84, backgroundColor: level > 0.35 ? colors.accent : '#8A5A2E' }]} />
        ))}
      </View>

      <View style={styles.middle}>
        {phase === 'sending' ? (
          <View style={{ alignItems: 'center', gap: 14 }}>
            <ActivityIndicator size="large" color={colors.accent} />
            <Body muted>Turning your note into changes. This takes a few seconds.</Body>
          </View>
        ) : phase === 'error' ? (
          <View style={{ gap: 14, alignSelf: 'stretch' }}>
            <Message text={error} tone="error" />
            <SecondaryButton title="Record again" icon="mic" onPress={() => void start()} />
          </View>
        ) : (
          <Body muted>Talk like you'd tell the office: who, which job, what happened, what's needed.</Body>
        )}
      </View>

      <View style={styles.bottom}>
        {recording && (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done talking"
              disabled={phase !== 'recording'}
              onPress={() => void finish()}
              style={({ pressed }) => [styles.stop, pressed && { transform: [{ scale: 0.96 }] }]}
            >
              <View style={styles.stopSquare} />
            </Pressable>
            <Text style={styles.stopLabel}>Tap when you're done</Text>
          </>
        )}
        {phase !== 'sending' && <TextButton title="Cancel" onPress={() => void cancel()} />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.danger },
  liveText: { fontFamily: fonts.display, fontSize: 18, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.danger },
  timer: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.text, fontVariant: ['tabular-nums'] },
  meter: { height: 110, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 24 },
  bar: { width: 9, borderRadius: 5 },
  middle: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  bottom: { alignItems: 'center', gap: 12, paddingBottom: 8 },
  stop: { width: 136, height: 136, borderRadius: 68, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', borderWidth: 10, borderColor: colors.accentWash },
  stopSquare: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.onAccent },
  stopLabel: { fontFamily: fonts.display, fontSize: 22, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.text },
});
