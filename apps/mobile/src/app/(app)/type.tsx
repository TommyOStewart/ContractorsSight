import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '../../auth/SessionProvider';
import { usePending } from '../../data/PendingProvider';
import { worker, WorkerError } from '../../lib/worker';
import { BigButton, Display, Field, IconButton, Message, Screen, Small, TextButton } from '../../ui';

export default function TypeScreen() {
  const { memberships } = useSession();
  const { refresh } = usePending();
  const { jobId, jobTitle } = useLocalSearchParams<{ jobId?: string; jobTitle?: string }>();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function send() {
    if (!text.trim()) return;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await worker.createCapture({ orgId: memberships[0]!.orgId, text: text.trim(), targetJobId: jobId });
      void refresh();
      if (result.changeSetId) router.replace(`/review/${result.changeSetId}`);
      else {
        setText('');
        setNotice(result.summary ?? 'Nothing to record in that note.');
      }
    } catch (e) {
      setError(e instanceof WorkerError ? e.message : 'Something went wrong sending that note.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <BigButton title={busy ? 'Reading…' : 'Send'} icon="send" onPress={send} busy={busy} disabled={!text.trim()} />
          {busy && <Small>Sorting it into jobs. This takes a few seconds.</Small>}
        </>
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Display size={30}>Type it</Display>
        <IconButton icon="x" label="Close" onPress={() => router.back()} />
      </View>
      {jobTitle && <Small>About: {jobTitle}</Small>}
      <Field
        label="What happened?"
        value={text}
        onChangeText={setText}
        multiline
        autoFocus
        placeholder={"e.g. Henderson okayed the water heater quote. Need 2 SB couplings for Maria's repipe."}
      />
      <Message text={error} tone="error" />
      <Message text={notice} tone="success" />
      {notice && <TextButton title="Done" onPress={() => router.back()} />}
    </Screen>
  );
}
