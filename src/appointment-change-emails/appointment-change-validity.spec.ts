import { Types } from 'mongoose';
import { AppointmentDocument } from '../appointments/entities/appointment.entity';
import { AppointmentChangeEmail } from './entities/appointment-change-email.entity';
import { changeStillApplies } from './appointment-change-validity';

describe('Closure notification relevance', () => {
  const deadline = new Date('2026-10-29T04:00:00Z');
  const patient = new Types.ObjectId(), clinic = new Types.ObjectId();
  const current = { patient, clinic, status: 'needs_rescheduling', date: new Date('2026-11-02'), startTime: '10:00', endTime: '10:30', scheduleVersion: 1,
    disruption: { closures: [new Types.ObjectId()] }, closureRescheduling: { expiresAt: deadline } } as unknown as AppointmentDocument;
  const notice = { patient, clinic, kind: 'disrupted', scheduleVersion: 1, schedule: { date: '2026-11-02', startTime: '10:00', endTime: '10:30' }, proposalDeadline: deadline } as AppointmentChangeEmail;
  afterEach(() => jest.restoreAllMocks());
  it('suppresses retries after the replacement deadline and after a later decline starts a new window', () => {
    jest.spyOn(Date, 'now').mockReturnValue(deadline.getTime() - 1);
    expect(changeStillApplies(notice, current)).toBe(true);
    expect(changeStillApplies({ ...notice, proposalDeadline: new Date('2026-10-28T04:00:00Z') }, current)).toBe(false);
    jest.mocked(Date.now).mockReturnValue(deadline.getTime());
    expect(changeStillApplies(notice, current)).toBe(false);
    expect(changeStillApplies({ ...notice, kind: 'needs_rescheduling' }, current)).toBe(false);
  });
});
