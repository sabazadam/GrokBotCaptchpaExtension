import type { ExtMessage } from "./lib/messages.js";
import { getSettings } from "./lib/storage.js";
import { handleMessage } from "./lib/handler.js";

chrome.runtime.onMessage.addListener((message: ExtMessage, _sender, sendResponse) => {
  void (async () => {
    try {
      const settings = await getSettings();
      const result = await handleMessage(message, settings);
      sendResponse(result);
    } catch (err) {
      sendResponse({
        status: "error",
        code: "internal_error",
        message: (err as Error)?.message ?? "bilinmeyen hata",
      });
    }
  })();
  return true; // asenkron yanıt
});
