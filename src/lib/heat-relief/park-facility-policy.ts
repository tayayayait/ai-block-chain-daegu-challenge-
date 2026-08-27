import type { ParkRestType } from "@/integrations/heat-relief/park-facility.server";

export function isParkFacilitySafeForRouting(
  input: Readonly<{
    restType: ParkRestType | null;
    condition: string | null;
    repairRequired: boolean | null;
  }>,
): boolean {
  if (input.restType === null || input.repairRequired === true) return false;
  return !/불량|위험|사용\s*불가|폐쇄|철거/u.test(input.condition ?? "");
}
