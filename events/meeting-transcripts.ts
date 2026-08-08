// Feldebene wie im eingefrorenen Architekturmodell festgelegt (1:1 zu Meeting).
export interface MeetingTranscript {
  id: string;
  meetingId: string;
  transcriptText: string;
  keyTopics?: string[];
}
