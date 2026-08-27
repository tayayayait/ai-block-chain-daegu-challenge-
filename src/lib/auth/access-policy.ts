export const STAFF_ROLES = ["ADMIN", "CARE_WORKER"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export type StaffProfile = Readonly<{
  id: string;
  organizationId: string;
  role: StaffRole;
}>;

export type SubjectScope = Readonly<{
  id: string;
  organizationId: string;
}>;

export function canAccessSubject(
  profile: StaffProfile,
  subject: SubjectScope,
  isAssigned: boolean,
): boolean {
  if (profile.organizationId !== subject.organizationId) {
    return false;
  }

  return profile.role === "ADMIN" || (profile.role === "CARE_WORKER" && isAssigned);
}
