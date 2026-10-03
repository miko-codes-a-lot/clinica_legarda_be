import { PatientSearchDto } from './dto/patient-search.dto';
export function patientSearchOptions(query: PatientSearchDto): { filter: Record<string, unknown>; sort: Record<string, 1 | -1> } {
  const filter: Record<string, unknown> = {};
  if (query.status) filter['status'] = query.status;
  if (query.registration) filter['isWalkIn'] = query.registration === 'walk_in' ? true : { $ne: true };
  const direction = query.direction === 'desc' ? -1 : 1;
  const fields = ['username', 'emailAddress', 'mobileNumber', 'status'];
  const sort: Record<string, 1 | -1> = query.sortBy && fields.includes(query.sortBy)
    ? { [query.sortBy]: direction, lastName: 1, firstName: 1, _id: 1 }
    : { lastName: direction, firstName: direction, _id: 1 };
  return { filter, sort };
}
