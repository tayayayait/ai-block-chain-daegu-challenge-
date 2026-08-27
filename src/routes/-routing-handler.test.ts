import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/routes/shelters.tsx"), "utf8");
const subjectRequestSource = readFileSync(
  resolve(process.cwd(), "src/lib/shelters/subject-request.server.ts"),
  "utf8",
);
const alertSubjectRequestSource = readFileSync(
  resolve(process.cwd(), "src/lib/shelters/alert-subject-request.server.ts"),
  "utf8",
);

describe("shelter route planning handler", () => {
  it("accepts only a shelter id and validated origin and resolves destination server-side", () => {
    expect(source).toMatch(
      /const RouteRequestSchema = z[\s\S]*shelterId[\s\S]*latitude[\s\S]*longitude/iu,
    );
    expect(source).toMatch(/createServerFn\(\{ method: "POST" \}\)[\s\S]*getShelterById/iu);
    expect(source).toMatch(/planDepartureComparison/iu);
    expect(source).toMatch(/requestDepartureComparison/iu);
  });

  it("never sends TMAP credentials or raw provider responses to the browser", () => {
    expect(source).not.toMatch(/TMAP_APP_KEY|appKey|providerDurationSec/iu);
  });

  it("reauthorizes subject-scoped search and routing before resolving private coordinates", () => {
    expect(source).toContain("ShelterRouteSearchSchema");
    expect(source).toMatch(/beforeLoad[\s\S]*requireSubjectRouteAccess/iu);
    expect(subjectRequestSource).toMatch(
      /authorizeSubjectShelterRequest[\s\S]*createSubjectShelterOriginRepository[\s\S]*findBySubjectId/iu,
    );
  });

  it("exposes check-in only through the authenticated subject-scoped request", () => {
    expect(source).toContain("submitSubjectShelterCheckIn");
    expect(source).toContain("createSupabaseCheckInRepository");
    expect(source).toContain('kind: "STAFF_SESSION"');
    expect(source).not.toMatch(/kind:\s*"PUBLIC"[\s\S]*submitShelterCheckIn/iu);
  });

  it("keeps alert shelter requests non-identifying and revalidates the cookie on every operation", () => {
    const alertSearchShape = source.slice(
      source.indexOf("const AlertShelterSearchSchema"),
      source.indexOf("const ShelterRouteSearchSchema"),
    );
    const alertRouteShape = source.slice(
      source.indexOf("const AlertRouteRequestSchema"),
      source.indexOf("const ShadeRouteRequestSchema"),
    );
    const alertCheckInShape = source.slice(
      source.indexOf("const AlertCheckInRequestSchema"),
      source.indexOf("function isSubjectSearch"),
    );

    expect(alertSearchShape).toContain('scope: z.literal("alert")');
    expect(`${alertSearchShape}${alertRouteShape}${alertCheckInShape}`).not.toMatch(
      /subjectId|eventId|latitude|longitude/iu,
    );
    expect(source.match(/authorizeAlertSubjectShelterRequest/g)).toHaveLength(5);
    expect(source).toContain('kind: "SUBJECT_SESSION"');
    expect(source).toContain("redactPrivateOrigin");
    expect(alertSubjectRequestSource).toMatch(
      /getRequestHeader\("cookie"\)[\s\S]*resolveAlertSubjectSessionToken[\s\S]*findBySubjectId/iu,
    );
  });
});
