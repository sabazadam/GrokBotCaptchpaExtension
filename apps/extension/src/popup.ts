import { apiActivate } from "./lib/apiClient.js";
import { getSettings, setSettings } from "./lib/storage.js";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`element yok: ${id}`);
  return el;
}

function setMsg(text: string, kind: "ok" | "err" | ""): void {
  const el = $("msg");
  el.textContent = text;
  el.className = `msg ${kind}`;
}

async function refresh(): Promise<void> {
  const settings = await getSettings();
  ($("backend") as HTMLInputElement).value = settings.backendUrl;

  const dot = $("statusDot");
  const toggle = $("toggle");
  dot.className = `dot ${settings.enabled ? "on" : "off"}`;
  toggle.textContent = settings.enabled ? "Açık" : "Kapalı";

  const tokenState = $("tokenState");
  if (!settings.deviceToken) {
    tokenState.textContent = "Cihaz etkinleştirilmedi";
    $("balance").textContent = "—";
    return;
  }
  tokenState.textContent = "Cihaz etkin";
  try {
    const res = await fetch(`${settings.backendUrl}/v1/balance`, {
      headers: { authorization: `Bearer ${settings.deviceToken}` },
    });
    const data = (await res.json()) as { remainingCredits?: number };
    $("balance").textContent = String(data.remainingCredits ?? "—");
  } catch {
    $("balance").textContent = "—";
  }
}

async function onActivate(): Promise<void> {
  const code = ($("code") as HTMLInputElement).value.trim();
  const backendUrl = ($("backend") as HTMLInputElement).value.trim();
  if (!code) {
    setMsg("Aktivasyon kodu girin", "err");
    return;
  }
  await setSettings({ backendUrl });
  setMsg("Etkinleştiriliyor…", "");
  try {
    const res = await apiActivate(backendUrl, code, "grok-bot");
    if ((res as { deviceToken?: string }).deviceToken) {
      await setSettings({ deviceToken: res.deviceToken });
      setMsg("Cihaz etkinleştirildi", "ok");
      ($("code") as HTMLInputElement).value = "";
      await refresh();
    } else {
      setMsg("Kod reddedildi", "err");
    }
  } catch {
    setMsg("Etkinleştirme başarısız (backend'e ulaşılamadı)", "err");
  }
}

async function onToggle(): Promise<void> {
  const settings = await getSettings();
  await setSettings({ enabled: !settings.enabled });
  await refresh();
}

$("activate").addEventListener("click", () => void onActivate());
$("toggle").addEventListener("click", () => void onToggle());
$("backend").addEventListener("change", () => {
  const backendUrl = ($("backend") as HTMLInputElement).value.trim();
  void setSettings({ backendUrl });
});

void refresh();
