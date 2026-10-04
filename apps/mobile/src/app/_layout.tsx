import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SessionProvider, useSession } from '../auth/SessionProvider';

// Keep the splash screen up until we know whether the user is signed in.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </SessionProvider>
  );
}

/**
 * Three mutually exclusive states, each with its own screens:
 * signed out → sign-in; signed in with no company → create-company; otherwise → the app.
 * Protected routes redirect automatically when the state changes (sign in, sign out, company created).
 */
function RootNavigator() {
  const { session, memberships, isLoading } = useSession();
  useEffect(() => {
    if (!isLoading) void SplashScreen.hideAsync();
  }, [isLoading]);
  if (isLoading) return null;

  const signedIn = session !== null;
  const hasCompany = memberships.length > 0;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !hasCompany}>
        <Stack.Screen name="create-company" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && hasCompany}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
    </Stack>
  );
}
