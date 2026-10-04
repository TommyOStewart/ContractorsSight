import { TOOLS } from '@contractorsight/shared';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// Placeholder. No screens yet; this only proves the app builds against the shared package.
// Colors are explicit: unset text color can render white-on-white on Android in dark mode.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ContractorSight</Text>
      <Text style={styles.body}>{TOOLS.length} capture tools defined in @contractorsight/shared</Text>
      <StatusBar style="dark" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16,
  },
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '600',
  },
  body: {
    color: '#374151',
    fontSize: 16,
    textAlign: 'center',
  },
});
