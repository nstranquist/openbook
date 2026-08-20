import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet } from "react-native";
import { WebView } from "react-native-webview";

const URL = process.env.EXPO_PUBLIC_OPENBOOK_URL || "http://127.0.0.1:5173";

export default function App() {
  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar style="auto" />
      <WebView source={{ uri: URL }} originWhitelist={["*"]} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#101827" },
});
