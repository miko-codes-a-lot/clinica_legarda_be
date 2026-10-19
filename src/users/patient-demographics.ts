import { BadRequestException } from '@nestjs/common';

export const DEMOGRAPHIC_FIELDS = ['birthDate', 'sex', 'occupation', 'religion', 'maritalStatus'] as const;
export type PatientDemographics = Partial<Record<typeof DEMOGRAPHIC_FIELDS[number], string>>;
export function patientDemographics(input: Partial<Record<typeof DEMOGRAPHIC_FIELDS[number], unknown>>, now = new Date(Date.now())): PatientDemographics {
  const result: PatientDemographics = {};
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  for (const field of DEMOGRAPHIC_FIELDS) {
    const raw = input[field];
    if (raw === undefined) continue;
    if (typeof raw !== 'string') throw new BadRequestException(`${field} must be text.`);
    const value = raw.trim();
    if (field === 'birthDate') {
      const parsed = new Date(`${value}T00:00:00Z`);
      if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value || value > today))
        throw new BadRequestException('Birth date must be a valid date on or before today.');
    } else if (value.length > 100) throw new BadRequestException(`${field} must be at most 100 characters.`);
    result[field] = value;
  }
  return result;
}
