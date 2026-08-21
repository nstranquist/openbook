import { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const DEFAULT_URL = "http://127.0.0.1:5173";
const OPENBOOK_URL = process.env.EXPO_PUBLIC_OPENBOOK_URL || DEFAULT_URL;
const EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function parseOpenbookOrigin() {
  try {
    const parsed = new URL(OPENBOOK_URL);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

const OPENBOOK_ORIGIN = parseOpenbookOrigin();

function canLoadInsideShell(url) {
  if (url === "about:blank") return true;

  try {
    return OPENBOOK_ORIGIN !== null && new URL(url).origin === OPENBOOK_ORIGIN;
  } catch {
    return false;
  }
}

function canOpenExternally(url) {
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function LoadError({ message, onRetry }) {
  return (
    <View accessibilityRole="alert" style={styles.errorPanel}>
      <Text style={styles.errorTitle}>Openbook could not load</Text>
      <Text style={styles.errorMessage}>{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
        >
          <Text style={styles.retryButtonText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function App() {
  const webViewRef = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack) return false;
      webViewRef.current?.goBack();
      return true;
    });

    return () => subscription.remove();
  }, [canGoBack]);

  const retry = () => {
    setLoadError(null);
    setReloadKey((current) => current + 1);
  };

  const handleNavigationRequest = (request) => {
    if (canLoadInsideShell(request.url)) return true;
    if (canOpenExternally(request.url)) {
      void Linking.openURL(request.url).catch(() => {
        Alert.alert("Could not open link", "Check that this device supports the link.");
      });
    }
    return false;
  };

  const content = OPENBOOK_ORIGIN ? (
    loadError ? (
      <LoadError message={loadError} onRetry={retry} />
    ) : (
      <WebView
        key={reloadKey}
        ref={webViewRef}
        allowsBackForwardNavigationGestures
        applicationNameForUserAgent="OpenbookMobile/0.1"
        onError={({ nativeEvent }) => {
          setLoadError(nativeEvent.description || "Check the server and your connection.");
        }}
        onHttpError={({ nativeEvent }) => {
          setLoadError(`The server returned HTTP ${nativeEvent.statusCode}.`);
        }}
        onNavigationStateChange={({ canGoBack: nextCanGoBack }) => {
          setCanGoBack(nextCanGoBack);
        }}
        onShouldStartLoadWithRequest={handleNavigationRequest}
        originWhitelist={["http://*", "https://*", "about:blank"]}
        pullToRefreshEnabled
        renderLoading={() => (
          <View accessibilityLabel="Loading Openbook" style={styles.loadingPanel}>
            <ActivityIndicator color="#f8fafc" size="large" />
          </View>
        )}
        setSupportMultipleWindows={false}
        source={{ uri: OPENBOOK_URL }}
        startInLoadingState
        style={styles.webView}
      />
    )
  ) : (
    <LoadError
      message="EXPO_PUBLIC_OPENBOOK_URL must be a valid HTTP or HTTPS URL."
    />
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.shell}>
        <StatusBar style="light" />
        {content}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#101827" },
  webView: { flex: 1, backgroundColor: "#101827" },
  loadingPanel: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#101827",
  },
  errorPanel: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
    backgroundColor: "#101827",
  },
  errorTitle: { color: "#f8fafc", fontSize: 22, fontWeight: "700", textAlign: "center" },
  errorMessage: { color: "#cbd5e1", fontSize: 16, lineHeight: 24, textAlign: "center" },
  retryButton: {
    minHeight: 44,
    minWidth: 120,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: "#2563eb",
  },
  retryButtonPressed: { opacity: 0.8 },
  retryButtonText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
});
