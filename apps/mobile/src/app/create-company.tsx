import { useState } from 'react';
import { useSession } from '../auth/SessionProvider';
import { supabase } from '../lib/supabase';
import { Body, Button, Field, Message, Screen, Title } from '../ui';

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
    <Screen>
      <Title>Set up your company</Title>
      <Body muted>
        Clients, jobs, and quotes belong to a company, so teammates you add later can see the same work.
      </Body>
      <Field label="Company name" value={name} onChangeText={setName} autoCapitalize="words" onSubmitEditing={create} />
      <Message text={error} tone="error" />
      <Button title="Create company" onPress={create} busy={busy} />
      <Body muted>Signed in as {session?.user.email}</Body>
      <Button variant="link" title="Sign out" onPress={signOut} />
    </Screen>
  );
}
