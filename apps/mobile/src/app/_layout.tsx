import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { BarlowCondensed_700Bold, BarlowCondensed_800ExtraBold } from '@expo-google-fonts/barlow-condensed';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SessionProvider, useSession } from '../auth/SessionProvider';
import { colors } from '../ui/theme';

// Keep the splash screen up until fonts are loaded and we know whether the user is signed in.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Barlow_400Regular,
    Barlow_500Medium,
    Barlow_600SemiBold,
    Barlow_700Bold,
    BarlowCondensed_700Bold,
    BarlowCondensed_800ExtraBold,
  });

  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RootNavigator fontsReady={fontsLoaded || !!fontError} />
    </SessionProvider>
  );
}

/**
 * Three mutually exclusive states, each with its own screens:
 * signed out → sign-in; signed in with no company → create-company; otherwise → the app.
 * Protected routes redirect automatically when the state changes (sign in, sign out, company created).
 */
function RootNavigator({ fontsReady }: { fontsReady: boolean }) {
  const { session, memberships, isLoading } = useSession();
  const ready = fontsReady && !isLoading;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  const signedIn = session !== null;
  const hasCompany = memberships.length > 0;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
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
