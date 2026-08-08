import { describe, expect, it } from "vitest";
import { addBusinessDays, isBusinessDay, isWeekend, nextBusinessDay } from "./calendar";

describe("calendar", () => {
  it("erkennt Wochenenden korrekt", () => {
    expect(isWeekend("2025-01-04")).toBe(true); // Samstag
    expect(isWeekend("2025-01-05")).toBe(true); // Sonntag
    expect(isWeekend("2025-01-06")).toBe(false); // Montag
  });

  it("isBusinessDay ist das Gegenteil von isWeekend", () => {
    expect(isBusinessDay("2025-01-06")).toBe(true);
    expect(isBusinessDay("2025-01-04")).toBe(false);
  });

  it("nextBusinessDay überspringt Wochenenden", () => {
    expect(nextBusinessDay("2025-01-03")).toBe("2025-01-06"); // Freitag -> Montag
    expect(nextBusinessDay("2025-01-06")).toBe("2025-01-07"); // Montag -> Dienstag
  });

  it("addBusinessDays zählt nur Arbeitstage", () => {
    // Freitag + 1 Arbeitstag = Montag
    expect(addBusinessDays("2025-01-03", 1)).toBe("2025-01-06");
    // Montag + 5 Arbeitstage = nächster Montag
    expect(addBusinessDays("2025-01-06", 5)).toBe("2025-01-13");
  });
});
