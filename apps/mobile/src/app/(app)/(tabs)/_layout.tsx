import { Feather } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePending } from '../../../data/PendingProvider';
import { InTabsContext } from '../../../ui';
import { colors, fonts } from '../../../ui/theme';

// Four tabs, no more: the app should feel like one big button, not something to learn.
export default function TabsLayout() {
  const { items } = usePending();
  // The bar sits above the phone's own navigation bar (Android) or home indicator (iOS), not under it.
  const bottom = useSafeAreaInsets().bottom;
  return (
    <InTabsContext.Provider value={true}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
          tabBarStyle: { backgroundColor: colors.surfaceSunk, borderTopColor: colors.divider, height: 68 + bottom, paddingTop: 8, paddingBottom: 10 + bottom },
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
        <Tabs.Screen name="customers" options={{ title: 'Customers', tabBarIcon: ({ color }) => <Feather name="users" size={26} color={color} /> }} />
        {/* A desk screen: a tab on computers; on phones it opens from Account. */}
        <Tabs.Screen
          name="business"
          options={{
            title: 'Business',
            href: Platform.OS === 'web' ? undefined : null,
            tabBarIcon: ({ color }) => <Feather name="bar-chart-2" size={26} color={color} />,
          }}
        />
      </Tabs>
    </InTabsContext.Provider>
  );
}
