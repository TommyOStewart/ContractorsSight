import { useState } from 'react';
import { View } from 'react-native';
import { supabase } from '../lib/supabase';
import { BigButton, Body, Display, Eyebrow, Field, Message, Screen, TextButton } from '../ui';

type Mode = 'signIn' | 'signUp';

export default function SignInScreen() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setNotice(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signIn') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setError(error.message);
        // On success the session listener moves us on.
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) setError(error.message);
        else if (!data.session) {
          setNotice('Check your email and tap the confirmation link, then come back and sign in.');
          setMode('signIn');
        }
      }
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(mode === 'signIn' ? 'signUp' : 'signIn');
    setError(null);
    setNotice(null);
  }

  return (
    <Screen center>
      <View style={{ gap: 6, marginBottom: 8 }}>
        <Eyebrow>ContractorSight</Eyebrow>
        <Display size={40}>{mode === 'signIn' ? 'Welcome back' : 'Get set up'}</Display>
        <Body muted>{mode === 'signIn' ? 'Sign in to your account.' : 'Create your account. It takes a minute.'}</Body>
      </View>

      {mode === 'signUp' && <Field label="Your name" value={fullName} onChangeText={setFullName} autoComplete="name" textContentType="name" />}
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        textContentType={mode === 'signIn' ? 'password' : 'newPassword'}
        onSubmitEditing={submit}
      />

      <Message text={error} tone="error" />
      <Message text={notice} tone="success" />

      <BigButton title={mode === 'signIn' ? 'Sign in' : 'Create account'} onPress={submit} busy={busy} />
      <TextButton title={mode === 'signIn' ? 'New here? Create an account' : 'Already have an account? Sign in'} onPress={switchMode} />
    </Screen>
  );
}
