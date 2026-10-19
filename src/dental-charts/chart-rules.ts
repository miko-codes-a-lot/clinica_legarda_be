import { BadRequestException } from '@nestjs/common';
export type Dentition = 'permanent' | 'primary';
export interface ToothObservation { tooth: number; observation: string; notes: string; }
export function toothNumbers(dentition: string): number[] {
  if (!['permanent','primary'].includes(dentition)) throw new BadRequestException('Select permanent or primary dentition.');
  const quadrants = dentition === 'permanent' ? [1,2,3,4] : [5,6,7,8];
  return quadrants.flatMap(quadrant => Array.from({ length: dentition === 'permanent' ? 8 : 5 }, (_, index) => quadrant * 10 + index + 1));
}
export function chartTeeth(dentition: string, input: unknown): ToothObservation[] {
  const allowed = toothNumbers(dentition);
  if (!Array.isArray(input) || input.length > allowed.length) throw new BadRequestException('Use at most one observation per tooth.');
  const seen = new Set<number>();
  return input.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('tooth' in entry) || typeof entry.tooth !== 'number' || !allowed.includes(entry.tooth) || seen.has(entry.tooth)) throw new BadRequestException('Tooth numbers must be valid, unique and match the selected dentition.');
    seen.add(entry.tooth);
    if (!('observation' in entry) || typeof entry.observation !== 'string' || !entry.observation.trim() || entry.observation.trim().length > 1000) throw new BadRequestException('Enter an observation of 1–1000 characters for each recorded tooth.');
    const notes = 'notes' in entry ? entry.notes ?? '' : '';
    if (typeof notes !== 'string' || notes.trim().length > 2000) throw new BadRequestException('Tooth notes must be text of at most 2000 characters.');
    return { tooth: entry.tooth, observation: entry.observation.trim(), notes: notes.trim() };
  }).sort((a,b) => a.tooth - b.tooth);
}
