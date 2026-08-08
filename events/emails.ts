import type { InteractionBase } from "./interaction-base";

// Feldebene wie im eingefrorenen Architekturmodell festgelegt.
export interface Email extends InteractionBase {
  subject: string;
  bodySummary: string;
  participantEmployeeIds?: string[];
}
