import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

import { assertDevComponentsAccess } from "@/demo/dev-components-access";

const devRouteComponent = import.meta.env.DEV
  ? lazyRouteComponent(() => import("@/demo/DevComponentsGallery"), "DevComponentsGallery")
  : undefined;

export const Route = createFileRoute("/dev/components")({
  beforeLoad: () => {
    assertDevComponentsAccess(import.meta.env.DEV);
  },
  ...(devRouteComponent ? { component: devRouteComponent } : {}),
});
