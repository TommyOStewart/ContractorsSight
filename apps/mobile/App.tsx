import { TOOLS } from '@contractorsight/shared';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// Placeholder. No screens yet; this only proves the app builds against the shared package.
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ContractorSight</Text>
      <Text>{TOOLS.length} capture tools defined in @contractorsight/shared</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
  },
});
