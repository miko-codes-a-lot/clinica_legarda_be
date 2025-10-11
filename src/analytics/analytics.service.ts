import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AppointmentStatus } from 'src/_shared/enum/appointment-status.enum';
import {
  Appointment,
  AppointmentDocument,
} from 'src/appointments/entities/appointment.entity';
import {
  Notification,
  NotificationDocument,
  NotificationType,
} from 'src/notifications/entities/notification.entity';

// Helper function to get the start of the week (Monday)
function getStartOfWeek(): Date {
  const date = new Date();
  const day = date.getDay() || 7; // Get 1-7, where 7 is Sunday
  if (day !== 1) date.setHours(-24 * (day - 1)); // Go back to Monday
  date.setHours(0, 0, 0, 0);
  return date;
}

// Helper to generate the last 7 days for the trend chart
function getLast7Days(): { label: string; date: Date }[] {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const results: { label: string; date: Date }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    results.push({
      label: days[d.getDay()],
      date: new Date(d.setHours(0, 0, 0, 0)),
    });
  }
  return results;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Appointment.name)
    private appointmentModel: Model<AppointmentDocument>,
    @InjectModel(Notification.name)
    private notificationModel: Model<NotificationDocument>,
  ) {}

  /**
   * Calculates the weekly summary data for the dashboard.
   * @param clinicId The ID of the clinic to filter by.
   */
  async getWeeklySummary(clinicId: string) {
    const clinicObjectId = new Types.ObjectId(clinicId);
    const startOfWeek = getStartOfWeek();
    const today = new Date();

    // 1. Calculate Total Appointments and Preferred Services (Aggregation)
    const preferredServicesAggregation = await this.appointmentModel.aggregate([
      {
        $match: {
          clinic: clinicObjectId,
          createdAt: { $gte: startOfWeek, $lte: today },
        },
      },
      {
        $lookup: {
          from: 'services',
          localField: 'services',
          foreignField: '_id',
          as: 'serviceDetails',
        },
      },
      { $unwind: '$serviceDetails' },
      {
        $group: {
          _id: '$serviceDetails.name',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 4 },
    ]);

    // 2. Calculate Total Appointments (Count)
    const totalAppointments = await this.appointmentModel.countDocuments({
      clinic: clinicObjectId,
      createdAt: { $gte: startOfWeek, $lte: today },
    });

    // 3. Calculate Patient Records Changed (Approximated by counting status updates)
    // We count notifications that indicate an appointment status update
    const recordsUpdated = await this.notificationModel.countDocuments({
      createdAt: { $gte: startOfWeek, $lte: today },
      type: NotificationType.APPOINTMENT_STATUS_UPDATED,
    });

    // Format preferred services result
    const preferredServices = preferredServicesAggregation.reduce(
      (acc, item) => {
        acc[item._id] = item.count;
        return acc;
      },
      {},
    );

    return {
      weekOf: startOfWeek,
      totalAppointments,
      patientRecordsChanged: recordsUpdated,
      preferredServices,
    };
  }

  /**
   * Calculates the weekly appointment trend (scheduled vs. completed) for the last 7 days.
   * @param clinicId The ID of the clinic to filter by.
   */
  async getWeeklyAppointmentTrend(clinicId: string) {
    const clinicObjectId = new Types.ObjectId(clinicId);
    const last7Days = getLast7Days();
    const startDate = last7Days[0].date;
    const endDate = last7Days[last7Days.length - 1].date;
    endDate.setDate(endDate.getDate() + 1); // Go to the start of the next day

    // MongoDB Aggregation for daily counts
    const trendAggregation = await this.appointmentModel.aggregate([
      {
        $match: {
          clinic: clinicObjectId,
          // Filter by date range (last 7 days)
          createdAt: { $gte: startDate, $lt: endDate },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          appointments: { $sum: 1 },
          completed: {
            $sum: {
              $cond: [
                { $eq: ['$status', AppointmentStatus.COMPLETED] },
                1, // If status is completed
                0, // Otherwise
              ],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Post-process to ensure all 7 days are present in the result
    const trendMap = new Map(trendAggregation.map((item) => [item._id, item]));

    const labels: string[] = [];
    const scheduledData: number[] = [];
    const completedData: number[] = [];

    last7Days.forEach((day) => {
      const dateString = day.date.toISOString().split('T')[0];
      const data = trendMap.get(dateString) || {
        appointments: 0,
        completed: 0,
      };

      labels.push(day.label);
      scheduledData.push(data.appointments);
      completedData.push(data.completed);
    });

    return {
      labels,
      appointments: scheduledData,
      completed: completedData,
    };
  }

  /**
   * Retrieves the current day's appointment queue for display on the dashboard.
   */
  async getDailyAppointmentQueue(clinicId: string) {
    const clinicObjectId = new Types.ObjectId(clinicId);
    const today = new Date().toISOString().split('T')[0];

    const queue = await this.appointmentModel
      .find({
        clinic: clinicObjectId,
        // Match appointments scheduled for today (using the 'date' field)
        date: {
          $gte: new Date(today),
          $lt: new Date(today + 'T23:59:59.999Z'),
        },
        status: {
          $in: [AppointmentStatus.PENDING, AppointmentStatus.CONFIRMED],
        },
      })
      .select('startTime patient services')
      .populate('patient', 'firstName lastName') // Populate patient name
      .populate('services', 'name') // Populate service name
      .sort('startTime')
      .limit(5)
      .exec();

    return queue.map((appt) => ({
      time: appt.startTime,
      patientName: `${(appt.patient as any).firstName} ${(appt.patient as any).lastName}`,
      service: (appt.services[0] as any)?.name || 'Multiple Services',
    }));
  }
}
