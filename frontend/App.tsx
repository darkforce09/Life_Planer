import { StatusBar } from 'expo-status-bar';
import { SafeAreaView, StyleSheet, ScrollView } from 'react-native';
import { TaskWidget } from './src/components/TaskWidget';
import { SystemHealthWidget } from './src/components/SystemHealthWidget';
import { ApprovalsWidget } from './src/components/ApprovalsWidget';

export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <SystemHealthWidget />
        <ApprovalsWidget />
        <TaskWidget />
      </ScrollView>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    paddingTop: 40,
  },
  scroll: {
    flexGrow: 1,
  }
});
