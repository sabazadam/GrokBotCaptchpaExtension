import type { SolveResponse } from "@grokbot/shared";
import type { SolveMessage } from "./lib/messages.js";
import { detectCaptchas, toSolveRequest } from "./lib/detect.js";
import { injectSolution } from "./lib/inject.js";

const inFlight = new Set<string>();
const solved = new Set<string>();

async function processOnce(): Promise<void> {
  const found = detectCaptchas(document);
  for (const c of found) {
    const key = `${c.type}:${c.websiteKey ?? ""}`;
    if (inFlight.has(key) || solved.has(key)) continue;
    inFlight.add(key);
    try {
      const message: SolveMessage = { kind: "solve", request: toSolveRequest(c, location.href) };
      const res = (await chrome.runtime.sendMessage(message)) as SolveResponse | undefined;
      if (res && res.status === "solved" && res.solution.token) {
        injectSolution(c.type, res.solution.token, document);
        solved.add(key);
      }
    } catch {
      // sessizce yoksay — bir sonraki taramada tekrar denenir
    } finally {
      inFlight.delete(key);
    }
  }
}

let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    void processOnce();
  }, 500);
}

void processOnce();
const observer = new MutationObserver(() => schedule());
observer.observe(document.documentElement, { childList: true, subtree: true });
