export interface UserActor {
  sub: string;
  role: string;
  username?: string;
  /** Current persisted assignments, resolved at the authentication boundary. */
  clinics?: readonly string[];
  /** Self plus currently linked children; resolved from persistence, never JWT claims. */
  patientIds?: readonly string[];
}

/** Management capability; record ownership is enforced separately. */
export function isAdmin(actor: Pick<UserActor, 'role'> | undefined): boolean {
  return actor?.role === 'admin' || actor?.role === 'super-admin';
}

export function actorPatientIds(actor: UserActor): string[] { return [...new Set([actor.sub, ...(actor.patientIds ?? [])])]; }
