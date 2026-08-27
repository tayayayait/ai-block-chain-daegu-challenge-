import { describe, expect, it } from "vitest";

import {
  parseShelterSearchParams,
  serializeShelterSearchParams,
  ShelterSearchQuerySchema,
} from "./search-schema";
import * as shelterSearchContract from "./search-schema";

describe("shelter URL search schema", () => {
  it("parses the complete public URL filter contract", () => {
    expect(
      parseShelterSearchParams(
        new URLSearchParams({
          lat: "35.871",
          lng: "128.601",
          radius: "1000",
          gu: "중구",
          imBank: "true",
          open: "OPEN",
          sort: "distance",
          limit: "25",
        }),
      ),
    ).toEqual({
      lat: 35.871,
      lng: 128.601,
      radius: 1000,
      gu: "중구",
      imBank: true,
      open: "OPEN",
      sort: "distance",
      limit: 25,
    });
  });

  it("applies bounded defaults without coercing false to true", () => {
    expect(
      parseShelterSearchParams(
        new URLSearchParams({ lat: "35.871", lng: "128.601", imBank: "false" }),
      ),
    ).toEqual({
      lat: 35.871,
      lng: 128.601,
      radius: 500,
      imBank: false,
      open: "ALL",
      sort: "priority",
      limit: 50,
    });
  });

  it("uses the public Daegu center without requesting browser location on entry", () => {
    expect(parseShelterSearchParams(new URLSearchParams())).toEqual({
      lat: 35.8714,
      lng: 128.6014,
      radius: 500,
      imBank: false,
      open: "ALL",
      sort: "priority",
      limit: 50,
    });
  });

  it("classifies the default Daegu reference separately from a selected location", () => {
    const inferOrigin = Reflect.get(
      shelterSearchContract,
      "inferPublicShelterOriginSource",
    ) as unknown;

    expect(inferOrigin).toBeTypeOf("function");
    if (typeof inferOrigin !== "function") return;

    expect(inferOrigin({ lat: 35.8714, lng: 128.6014 })).toBe("DAEGU_CENTER");
    expect(inferOrigin({ lat: 35.88, lng: 128.62 })).toBe("SELECTED_LOCATION");
  });

  it.each([
    { lat: 91, lng: 128.6 },
    { lat: 35.8, lng: 181 },
    { lat: 35.8, lng: 128.6, radius: 750 },
    { lat: 35.8, lng: 128.6, limit: 101 },
    { lat: 35.8, lng: 128.6, imBank: "yes" },
  ])("rejects out-of-contract query %#", (query) => {
    expect(ShelterSearchQuerySchema.safeParse(query).success).toBe(false);
  });

  it("serializes only the shared allowlist and never carries addresses or subject IDs", () => {
    const query = parseShelterSearchParams(
      new URLSearchParams({ lat: "35.871", lng: "128.601", gu: "중구" }),
    );
    const serialized = serializeShelterSearchParams(query);

    expect(serialized.get("lat")).toBe("35.871");
    expect(serialized.get("gu")).toBe("중구");
    expect([...serialized.keys()].sort()).toEqual([
      "gu",
      "imBank",
      "lat",
      "limit",
      "lng",
      "open",
      "radius",
      "sort",
    ]);
    expect(serialized.toString()).not.toMatch(/address|subject/i);
  });
});
