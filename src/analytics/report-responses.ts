export interface WeeklySummaryResponse {
  weekOf: string;
  weekEnd: string;
  today: string;
  totalAppointments: number;
  appointmentsUpdated: number;
  preferredServices: Record<string, number>;
  declinedReferrals: Record<string, number>;
}

export interface WeeklyTrendResponse {
  weekOf: string;
  weekEnd: string;
  labels: string[];
  appointments: number[];
  completed: number[];
  serviceTrend: Record<string, number[]>;
}

export interface DailyQueueResponse {
  appointmentId: string;
  time: string;
  patientName: string;
  service: string;
  clinicId: string;
  clinicName: string;
}
