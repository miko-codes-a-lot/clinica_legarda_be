export interface UserActor {
  sub: string;
  role: string;
  username?: string;
  /** Current persisted assignments, resolved at the authentication boundary. */
  clinics?: readonly string[];
}

/** Management capability; record ownership is enforced separately. */
export function isAdmin(actor: Pick<UserActor, 'role'> | undefined): boolean {
  return actor?.role === 'admin' || actor?.role === 'super-admin';
}
