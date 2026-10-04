import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { usePending } from '../../../data/PendingProvider';
import { colors, fonts } from '../../../ui/theme';

// Three tabs, no more: the app should feel like one big button, not something to learn.
export default function TabsLayout() {
  const { items } = usePending();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surfaceSunk, borderTopColor: colors.divider, height: 76, paddingTop: 8, paddingBottom: 12 },
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 14 },
        tabBarBadgeStyle: { backgroundColor: colors.accent, color: colors.onAccent, fontFamily: fonts.bold },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Capture', tabBarIcon: ({ color }) => <Feather name="mic" size={26} color={color} /> }} />
      <Tabs.Screen
        name="review"
        options={{
          title: 'Review',
          tabBarBadge: items.length || undefined,
          tabBarIcon: ({ color }) => <Feather name="check-square" size={26} color={color} />,
        }}
      />
      <Tabs.Screen name="jobs" options={{ title: 'Jobs', tabBarIcon: ({ color }) => <Feather name="tool" size={26} color={color} /> }} />
    </Tabs>
  );
}
