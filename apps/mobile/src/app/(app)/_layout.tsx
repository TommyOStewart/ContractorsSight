import { Stack } from 'expo-router';
import { PendingProvider } from '../../data/PendingProvider';
import { colors } from '../../ui/theme';

// Screens for signed-in users who belong to a company: the tabs, plus full-screen steps on top.
export default function AppLayout() {
  return (
    <PendingProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="type" options={{ presentation: 'modal' }} />
        <Stack.Screen name="record" options={{ presentation: 'fullScreenModal', gestureEnabled: false }} />
        <Stack.Screen name="photo" options={{ presentation: 'modal' }} />
        <Stack.Screen name="review/[id]" />
        <Stack.Screen name="job/[id]" />
        <Stack.Screen name="account" options={{ presentation: 'modal' }} />
      </Stack>
    </PendingProvider>
  );
}
