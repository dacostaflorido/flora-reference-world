import type { InteractionBase } from "./interaction-base";

// Feldebene wie im eingefrorenen Architekturmodell festgelegt.
export interface Call extends InteractionBase {
  durationMinutes: number;
  callType: "erstgespraech" | "follow-up" | "closing";
  objectionCategory?: string;
}
