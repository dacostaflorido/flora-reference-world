import type { SalesAppointment, SalesAppointmentType, SalesAppointmentNoShowParty } from "../world/sales-appointments";

// Sales Appointment Lifecycle Events — reine, wörtliche Projektion der bereits
// generierten SalesAppointment-Wahrheit (world/sales-appointments.ts), exakt
// dasselbe Muster (Variante A) wie events/delivery-lifecycle.ts für
// DeliveryUnit: SalesAppointment bleibt die generierte Wahrheit, jedes Event
// unten ist ein direkter, wörtlicher Lesezugriff auf ein bereits vorhandenes
// SalesAppointment-Feld — keine unabhängige Neuberechnung, kein zweiter
// RNG-Aufruf, keine Möglichkeit einer Abweichung.
//
// appointmentId ist der verpflichtende Anker für Backward Explainability
// (Prinzip 18): jedes Event ist darüber bis zu SalesAppointment →
// Lead/Opportunity → Contact/Account zurückverfolgbar. Event-IDs werden direkt
// aus der bereits eindeutigen SalesAppointment.id abgeleitet (bei Reschedules
// zusätzlich durch den Index in der bereits chronologischen reschedules-Liste),
// kein eigener Zähler.

export interface SalesAppointmentBooked {
  id: string;
  appointmentId: string;
  appointmentType: SalesAppointmentType;
  bookedAt: string;
  scheduledFor: string;
  bookedByEmployeeId?: string;
  assignedEmployeeId: string;
}

export interface SalesAppointmentRescheduled {
  id: string;
  appointmentId: string;
  appointmentType: SalesAppointmentType;
  rescheduledAt: string;
  previousScheduledFor: string;
  newScheduledFor: string;
  reasonCode?: string;
}

export interface SalesAppointmentCancelled {
  id: string;
  appointmentId: string;
  appointmentType: SalesAppointmentType;
  cancelledAt: string;
  lastScheduledFor: string;
  reasonCode?: string;
  cancelledByEmployeeId?: string;
}

export interface SalesAppointmentNoShowRecorded {
  id: string;
  appointmentId: string;
  appointmentType: SalesAppointmentType;
  recordedAt: string;
  scheduledFor: string;
  noShowParty?: SalesAppointmentNoShowParty;
}

export interface SalesAppointmentHeld {
  id: string;
  appointmentId: string;
  appointmentType: SalesAppointmentType;
  heldAt: string;
  conductedByEmployeeId: string;
}

function bookedEventId(appointment: SalesAppointment): string {
  return `sappt-booked-${appointment.id}`;
}
function rescheduledEventId(appointment: SalesAppointment, index: number): string {
  return `sappt-rescheduled-${appointment.id}-${index + 1}`;
}
function cancelledEventId(appointment: SalesAppointment): string {
  return `sappt-cancelled-${appointment.id}`;
}
function noShowEventId(appointment: SalesAppointment): string {
  return `sappt-noshow-${appointment.id}`;
}
function heldEventId(appointment: SalesAppointment): string {
  return `sappt-held-${appointment.id}`;
}

// 1:1 zu jedem SalesAppointment — die Buchung entsteht mit dem Appointment
// selbst (bookedAt ist bereits Future-Knowledge-sicher <= WORLD_NOW gesetzt,
// siehe world/sales-appointments.ts).
export function generateSalesAppointmentBookedEvents(appointments: readonly SalesAppointment[]): SalesAppointmentBooked[] {
  return appointments.map((a) => ({
    id: bookedEventId(a),
    appointmentId: a.id,
    appointmentType: a.appointmentType,
    bookedAt: a.bookedAt,
    scheduledFor: a.initialScheduledFor,
    bookedByEmployeeId: a.bookedByEmployeeId,
    assignedEmployeeId: a.assignedEmployeeId,
  }));
}

// 0..n je Appointment (bereits auf WORLD_NOW zensiert in a.reschedules) —
// mehrere Reschedules sind ausdrücklich zulässig (Auftrag B7).
export function generateSalesAppointmentRescheduledEvents(
  appointments: readonly SalesAppointment[],
): SalesAppointmentRescheduled[] {
  const events: SalesAppointmentRescheduled[] = [];
  for (const a of appointments) {
    a.reschedules.forEach((r, index) => {
      events.push({
        id: rescheduledEventId(a, index),
        appointmentId: a.id,
        appointmentType: a.appointmentType,
        rescheduledAt: r.rescheduledAt,
        previousScheduledFor: r.previousScheduledFor,
        newScheduledFor: r.newScheduledFor,
        reasonCode: r.reasonCode,
      });
    });
  }
  return events;
}

// Nur für Units, deren Storno zu WORLD_NOW bereits tatsächlich sichtbar ist.
export function generateSalesAppointmentCancelledEvents(
  appointments: readonly SalesAppointment[],
): SalesAppointmentCancelled[] {
  return appointments
    .filter((a): a is SalesAppointment & { cancelledAt: string } => a.currentStatus === "cancelled" && a.cancelledAt !== undefined)
    .map((a) => ({
      id: cancelledEventId(a),
      appointmentId: a.id,
      appointmentType: a.appointmentType,
      cancelledAt: a.cancelledAt,
      lastScheduledFor: a.currentScheduledFor,
      reasonCode: a.cancelledReasonCode,
      cancelledByEmployeeId: a.cancelledByEmployeeId,
    }));
}

export function generateSalesAppointmentNoShowEvents(
  appointments: readonly SalesAppointment[],
): SalesAppointmentNoShowRecorded[] {
  return appointments
    .filter((a): a is SalesAppointment & { noShowRecordedAt: string } => a.currentStatus === "no-show" && a.noShowRecordedAt !== undefined)
    .map((a) => ({
      id: noShowEventId(a),
      appointmentId: a.id,
      appointmentType: a.appointmentType,
      recordedAt: a.noShowRecordedAt,
      scheduledFor: a.currentScheduledFor,
      noShowParty: a.noShowParty,
    }));
}

export function generateSalesAppointmentHeldEvents(appointments: readonly SalesAppointment[]): SalesAppointmentHeld[] {
  return appointments
    .filter(
      (a): a is SalesAppointment & { heldAt: string; conductedByEmployeeId: string } =>
        a.currentStatus === "held" && a.heldAt !== undefined && a.conductedByEmployeeId !== undefined,
    )
    .map((a) => ({
      id: heldEventId(a),
      appointmentId: a.id,
      appointmentType: a.appointmentType,
      heldAt: a.heldAt,
      conductedByEmployeeId: a.conductedByEmployeeId,
    }));
}
