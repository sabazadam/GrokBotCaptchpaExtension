export interface Settings {
  backendUrl: string;
  deviceToken: string | null;
  enabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: "http://localhost:3000",
  deviceToken: null,
  enabled: true,
};

export async function getSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      (items) => resolve(items as unknown as Settings),
    );
  });
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(patch as Record<string, unknown>, () => resolve());
  });
}
