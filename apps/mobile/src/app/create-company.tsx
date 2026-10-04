import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { supabase } from '../lib/supabase';
import { BigButton, Body, colors, Display, Field, Message, Screen, Small, TextButton } from '../ui';

export default function CreateCompanyScreen() {
  const { session, refreshMemberships, signOut } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    if (!name.trim()) {
      setError('Enter your company name.');
      return;
    }
    setBusy(true);
    try {
      // An RPC rather than an insert: it creates the company and makes you its owner in one step.
      const { error } = await supabase.rpc('create_organization', { p_name: name.trim() });
      if (error) {
        setError(error.message);
        return;
      }
      await refreshMemberships(); // the router moves on to the app once a membership exists
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen center>
      <View style={{ gap: 6, marginBottom: 8 }}>
        <Display size={40}>Your company</Display>
        <Body muted>Clients and jobs belong to a company, so people you add later see the same work.</Body>
      </View>
      <Field label="Company name" value={name} onChangeText={setName} autoCapitalize="words" onSubmitEditing={create} placeholder="e.g. Stewart Plumbing" />
      <Message text={error} tone="error" />
      <BigButton title="Create company" onPress={create} busy={busy} />
      <Small color={colors.muted}>Signed in as {session?.user.email}</Small>
      <TextButton title="Sign out" onPress={signOut} />
    </Screen>
  );
}
