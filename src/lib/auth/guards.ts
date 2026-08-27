import { createPublicError, type PublicErrorDto } from "../error-dto";
import { canAccessSubject, type StaffProfile, type SubjectScope } from "./access-policy";

export type GuardRedirect = Readonly<{
  kind: "redirect";
  href: string;
}>;

export type GuardError = Readonly<{
  kind: "error";
  error: PublicErrorDto;
}>;

export type StaffGuardAllow = Readonly<{
  kind: "allow";
  profile: StaffProfile;
}>;

export type SubjectGuardAllow = Readonly<{
  kind: "allow";
  profile: StaffProfile;
  subject: SubjectScope;
}>;

export type StaffGuardResult = StaffGuardAllow | GuardRedirect | GuardError;
export type SubjectGuardResult = SubjectGuardAllow | GuardRedirect | GuardError;

export type AuthorizationRepository = Readonly<{
  findProfileByUserId(userId: string): Promise<StaffProfile | null>;
  findSubjectScopeById(subjectId: string): Promise<SubjectScope | null>;
  isSubjectAssignedToProfile(input: {
    organizationId: string;
    profileId: string;
    subjectId: string;
  }): Promise<boolean>;
}>;

export type StaffGuardInput = Readonly<{
  userId: string | null | undefined;
  nextPath: string;
}>;

export type SubjectGuardInput = StaffGuardInput &
  Readonly<{
    subjectId: string;
  }>;

const SAFE_NEXT_FALLBACK = "/dashboard";

function isProtectedStaffPath(nextPath: string): boolean {
  if (!nextPath.startsWith("/") || nextPath.startsWith("//") || nextPath.includes("\\")) {
    return false;
  }

  const pathname = nextPath.split(/[?#]/, 1)[0] ?? "";

  try {
    const segments = decodeURIComponent(pathname).split("/");
    if (segments.some((segment) => segment === "." || segment === "..")) {
      return false;
    }
  } catch {
    return false;
  }

  return (
    pathname === "/dashboard" ||
    pathname === "/shelters" ||
    pathname === "/subjects" ||
    pathname.startsWith("/subjects/") ||
    pathname === "/medication" ||
    pathname.startsWith("/medication/")
  );
}

export function createLoginRedirect(nextPath: string): GuardRedirect {
  const withoutFragment = nextPath.split("#", 1)[0] ?? SAFE_NEXT_FALLBACK;
  const safeNext = isProtectedStaffPath(withoutFragment) ? withoutFragment : SAFE_NEXT_FALLBACK;

  return Object.freeze({
    kind: "redirect",
    href: `/login?next=${encodeURIComponent(safeNext)}`,
  });
}

export async function requireStaffAccess(
  input: StaffGuardInput,
  repository: AuthorizationRepository,
): Promise<StaffGuardResult> {
  if (!input.userId) {
    return createLoginRedirect(input.nextPath);
  }

  try {
    const profile = await repository.findProfileByUserId(input.userId);
    if (!profile) {
      return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
    }

    return { kind: "allow", profile };
  } catch {
    return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
  }
}

export async function requireSubjectAccess(
  input: SubjectGuardInput,
  repository: AuthorizationRepository,
): Promise<SubjectGuardResult> {
  const staffResult = await requireStaffAccess(input, repository);
  if (staffResult.kind !== "allow") {
    return staffResult;
  }

  try {
    const subject = await repository.findSubjectScopeById(input.subjectId);
    if (!subject || subject.organizationId !== staffResult.profile.organizationId) {
      return { kind: "error", error: createPublicError("NOT_FOUND") };
    }

    if (staffResult.profile.role === "ADMIN") {
      return { kind: "allow", profile: staffResult.profile, subject };
    }

    const isAssigned = await repository.isSubjectAssignedToProfile({
      organizationId: staffResult.profile.organizationId,
      profileId: staffResult.profile.id,
      subjectId: subject.id,
    });

    if (!canAccessSubject(staffResult.profile, subject, isAssigned)) {
      return { kind: "error", error: createPublicError("NOT_FOUND") };
    }

    return { kind: "allow", profile: staffResult.profile, subject };
  } catch {
    return { kind: "error", error: createPublicError("INTERNAL_ERROR") };
  }
}
