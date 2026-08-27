import { z } from "zod";

export const DAEGU_GU = [
  "전체",
  "수성구",
  "중구",
  "달서구",
  "북구",
  "동구",
  "서구",
  "남구",
  "달성군",
] as const;

export const DASHBOARD_LEVELS = ["L2", "L3", "L4"] as const;
export const DASHBOARD_SORTS = ["hri", "age", "updated"] as const;
export const DASHBOARD_ORDERS = ["asc", "desc"] as const;

export const dashboardSearchSchema = z.object({
  gu: z.enum(DAEGU_GU).catch("전체").default("전체"),
  level: z.enum(DASHBOARD_LEVELS).catch("L3").default("L3"),
  sort: z.enum(DASHBOARD_SORTS).catch("hri").default("hri"),
  order: z.enum(DASHBOARD_ORDERS).catch("desc").default("desc"),
});

export type DashboardSearch = z.infer<typeof dashboardSearchSchema>;
