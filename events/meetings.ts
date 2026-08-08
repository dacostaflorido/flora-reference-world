import type { InteractionBase } from "./interaction-base";

// Feldebene wie im eingefrorenen Architekturmodell festgelegt. participantEmployeeIds
// ist bei internen Meetings (meetingType="internes-teammeeting"/"coaching"/
// "pipeline-review") verpflichtend. Das Feldmodell erlaubt nur einen einzigen
// opportunityId-Bezug — interne Meetings, die mehrere Opportunities betreffen (z. B.
// Pipeline Review), bleiben daher ohne opportunityId und referenzieren die
// betroffenen Deals stattdessen nur im zugehörigen MeetingTranscript (keyTopics/
// transcriptText), nicht als zusätzliche IDs.
export interface Meeting extends InteractionBase {
  durationMinutes: number;
  meetingType: "internes-teammeeting" | "kundentermin" | "coaching" | "pipeline-review";
  participantEmployeeIds?: string[];
}
