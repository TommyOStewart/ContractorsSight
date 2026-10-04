import { Feather } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { usePending } from '../../data/PendingProvider';
import { supabase } from '../../lib/supabase';
import { worker, WorkerError } from '../../lib/worker';
import { BigButton, Body, colors, Display, IconButton, Message, Screen, SecondaryButton, Small, TextButton } from '../../ui';

const MAX_PAGES = 5;
const MAX_WIDTH = 1600;

interface Page {
  uri: string;
  width: number;
}

/** Shrink to a readable size before upload: faster on a job site's signal, cheaper to read. */
async function prepare(page: Page): Promise<Uint8Array> {
  const context = ImageManipulator.manipulate(page.uri);
  if (page.width > MAX_WIDTH) context.resize({ width: MAX_WIDTH });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.75 });
  return new File(saved.uri).bytes();
}

export default function PhotoScreen() {
  const { memberships } = useSession();
  const { refresh } = usePending();
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noCamera, setNoCamera] = useState(false);

  async function takePhoto() {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setNoCamera(true);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled) {
      if (pages.length === 0) router.back();
      return;
    }
    setPages((prev) => [...prev, ...result.assets.map((a) => ({ uri: a.uri, width: a.width }))].slice(0, MAX_PAGES));
  }

  async function pickPhotos() {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PAGES - pages.length,
      quality: 0.9,
    });
    if (!result.canceled) setPages((prev) => [...prev, ...result.assets.map((a) => ({ uri: a.uri, width: a.width }))].slice(0, MAX_PAGES));
  }

  useEffect(() => {
    // One tap from the home screen straight into the camera.
    void takePhoto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    if (!pages.length) return;
    setBusy(true);
    setError(null);
    try {
      const orgId = memberships[0]!.orgId;
      const paths: string[] = [];
      for (const page of pages) {
        const path = `${orgId}/${Crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage.from('captures').upload(path, await prepare(page), { contentType: 'image/jpeg' });
        if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
        paths.push(path);
      }
      const result = await worker.createImageCapture({ orgId, imagePaths: paths });
      void refresh();
      if (result.changeSetId) router.replace(`/review/${result.changeSetId}`);
      else setError(result.summary ?? 'Nothing to record in that photo.');
    } catch (e) {
      setError(e instanceof WorkerError || e instanceof Error ? e.message : 'Something went wrong sending the photo.');
    } finally {
      setBusy(false);
    }
  }

  if (noCamera && pages.length === 0) {
    return (
      <Screen center>
        <Display size={32}>Camera is off</Display>
        <Body muted>Turn on camera access in Settings to snap receipts and notes, or pick photos you already took.</Body>
        <SecondaryButton title="Choose from photos" icon="image" onPress={() => void pickPhotos()} />
        <SecondaryButton title="Open Settings" icon="settings" onPress={() => void Linking.openSettings()} />
        <TextButton title="Back" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        <>
          <BigButton title={busy ? 'Reading…' : 'Send'} icon="send" onPress={() => void send()} busy={busy} disabled={!pages.length} />
          {busy && <Small>Reading the photo and sorting it into jobs. This takes a few seconds.</Small>}
        </>
      }
    >
      <View style={styles.header}>
        <Display size={30}>Photo</Display>
        <IconButton icon="x" label="Close" onPress={() => router.back()} />
      </View>
      <Body muted>Receipts, invoices, or your own notes. Add a page for each sheet.</Body>

      {pages.length === 0 ? (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <ScrollView horizontal contentContainerStyle={styles.strip} showsHorizontalScrollIndicator={false}>
          {pages.map((page, i) => (
            <View key={page.uri} style={styles.thumbWrap}>
              <Image source={{ uri: page.uri }} style={styles.thumb} accessibilityLabel={`Page ${i + 1}`} />
              {!busy && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove page ${i + 1}`}
                  onPress={() => setPages((prev) => prev.filter((_, j) => j !== i))}
                  style={styles.remove}
                  hitSlop={8}
                >
                  <Feather name="x" size={20} color={colors.text} />
                </Pressable>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      <Message text={error} tone="error" />
      {!busy && pages.length < MAX_PAGES && (
        <>
          <SecondaryButton title={pages.length ? 'Add another page' : 'Take a photo'} icon="camera" onPress={() => void takePhoto()} />
          <TextButton title="Choose from photos instead" onPress={() => void pickPhotos()} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  empty: { height: 280, alignItems: 'center', justifyContent: 'center' },
  strip: { gap: 12, paddingVertical: 4 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 200, height: 280, borderRadius: 12, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  remove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(22,24,27,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
