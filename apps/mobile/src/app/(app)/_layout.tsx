import { Stack } from 'expo-router';
import { colors } from '../../ui';

// Screens for signed-in users who belong to a company.
export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="review/[id]" options={{ title: 'Review changes' }} />
      <Stack.Screen name="jobs" options={{ title: 'Clients and jobs' }} />
    </Stack>
  );
}
