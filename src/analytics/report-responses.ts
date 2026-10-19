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

export interface ClinicAnalyticsReport {
  clinicId: string;
  generatedAt: string;
  period: { kind: 'week' | 'month' | 'year'; anchor: string; start: string; end: string; bucketKeys: string[]; labels: string[] };
  totalAppointments: number; uniquePatients: number;
  statuses: Record<string, number>;
  completed: number; noShow: number; completedShare: number; noShowRate: number;
  preferredServices: Record<string, number>;
  trend: { appointments: number[]; completed: number[]; noShow: number[]; serviceTrend: Record<string, number[]> };
  patientRecordChanges: { events: number; patients: number; counts: number[]; coverageFrom: string };
  metricDefinitions: { completedShare: string; noShowRate: string; patientRecordChanges: string };
}
