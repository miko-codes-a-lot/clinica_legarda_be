export interface UserActor {
  sub: string;
  role: string;
}

/** Admin membership is global; future restrictions belong in this policy. */
export function isAdmin(actor: Pick<UserActor, 'role'> | undefined): boolean {
  return actor?.role === 'admin' || actor?.role === 'super-admin';
}
