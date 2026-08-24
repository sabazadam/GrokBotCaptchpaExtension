import type { SolveRequest } from "@grokbot/shared";

export interface SolveMessage {
  kind: "solve";
  request: SolveRequest;
}

export interface StatusMessage {
  kind: "status";
}

export type ExtMessage = SolveMessage | StatusMessage;

export interface StatusReply {
  enabled: boolean;
  hasToken: boolean;
  remainingCredits: number | null;
}
