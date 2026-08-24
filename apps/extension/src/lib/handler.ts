import type { SolveResponse } from "@grokbot/shared";
import type { ExtMessage, StatusReply } from "./messages.js";
import type { Settings } from "./storage.js";
import { apiBalance, apiSolve } from "./apiClient.js";

/**
 * Arka plan (background) mesaj işleyicisinin saf çekirdeği (test edilebilir).
 * Ayarları ve mesajı alır, backend ile konuşur.
 */
export async function handleMessage(
  msg: ExtMessage,
  settings: Settings,
): Promise<SolveResponse | StatusReply> {
  if (msg.kind === "status") {
    let remainingCredits: number | null = null;
    if (settings.deviceToken) {
      try {
        const balance = await apiBalance(settings.backendUrl, settings.deviceToken);
        remainingCredits = balance.remainingCredits;
      } catch {
        remainingCredits = null;
      }
    }
    return {
      enabled: settings.enabled,
      hasToken: Boolean(settings.deviceToken),
      remainingCredits,
    };
  }

  if (!settings.enabled) {
    return { status: "error", code: "unauthorized", message: "Eklenti devre dışı" };
  }
  if (!settings.deviceToken) {
    return { status: "error", code: "unauthorized", message: "Cihaz etkinleştirilmedi" };
  }
  return apiSolve(settings.backendUrl, settings.deviceToken, msg.request);
}
