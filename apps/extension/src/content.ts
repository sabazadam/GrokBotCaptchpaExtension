import type { SolveResponse } from "@grokbot/shared";
import type { SolveMessage } from "./lib/messages.js";
import { detectCaptchas, toSolveRequest } from "./lib/detect.js";
import { injectSolution } from "./lib/inject.js";
import { SolveGate } from "./lib/solveGate.js";

const gate = new SolveGate(15_000);

async function processOnce(): Promise<void> {
  const found = detectCaptchas(document);
  for (const c of found) {
    const key = `${c.type}:${c.websiteKey ?? ""}`;
    if (!gate.tryBegin(key)) continue;
    try {
      const message: SolveMessage = { kind: "solve", request: toSolveRequest(c, location.href) };
      const res = (await chrome.runtime.sendMessage(message)) as SolveResponse | undefined;
      if (res && res.status === "solved" && res.solution.token) {
        injectSolution(c.type, res.solution.token, document);
        gate.markSolved(key);
      } else {
        gate.markFailed(key);
      }
    } catch {
      gate.markFailed(key);
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
