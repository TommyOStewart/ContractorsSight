import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { colors, fonts, Message, SecondaryButton } from '../ui';

/** Type a note and save it straight to the record, no AI step. */
export function NoteComposer({ onSave }: { onSave: (body: string) => Promise<string | null> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    const problem = await onSave(text.trim());
    setBusy(false);
    if (problem) setError(problem);
    else setText('');
  }

  return (
    <View style={{ gap: 8 }}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Add a note…"
        placeholderTextColor={colors.muted}
        selectionColor={colors.accent}
        accessibilityLabel="New note"
        multiline
        style={styles.input}
      />
      {!!text.trim() && <SecondaryButton title="Save note" icon="check" onPress={() => void save()} busy={busy} />}
      <Message text={error} tone="error" />
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: 'top',
  },
});
