function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerOpenbookWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return await navigator.serviceWorker.register("/sw.js");
}

export async function subscribePush(
  vapidPublicKey: string,
  save: (args: { endpoint: string; p256dh: string; auth: string }) => Promise<unknown>,
): Promise<void> {
  const reg = await registerOpenbookWorker();
  if (!reg || !("PushManager" in window)) {
    throw new Error("Push is not available in this browser");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications blocked");
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  });
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new Error("Push subscription incomplete");
  await save({ endpoint, p256dh, auth });
}

export async function unsubscribePush(
  drop: (args: { endpoint: string }) => Promise<unknown>,
): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await drop({ endpoint: sub.endpoint });
  await sub.unsubscribe();
}
