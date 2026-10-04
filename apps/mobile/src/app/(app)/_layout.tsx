import { Stack } from 'expo-router';

// Screens for signed-in users who belong to a company.
export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
