import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { dashboardSearchSchema } from "./search";

const acknowledgeSchema = z.object({
  transitionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/),
});

export const fetchDashboardSnapshot = createServerFn({ method: "GET" })
  .validator(dashboardSearchSchema)
  .handler(async ({ data }) => {
    const { readDashboardSnapshot } = await import("./runtime.server");
    return readDashboardSnapshot(data);
  });

export const acknowledgeDashboardL4 = createServerFn({ method: "POST" })
  .validator(acknowledgeSchema)
  .handler(async ({ data }) => {
    const { acknowledgeDashboardAlert } = await import("./runtime.server");
    await acknowledgeDashboardAlert(data.transitionId);
    return { acknowledged: true } as const;
  });
