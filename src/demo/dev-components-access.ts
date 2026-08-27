import { notFound } from "@tanstack/react-router";

export function assertDevComponentsAccess(isDevelopment: boolean): void {
  if (!isDevelopment) {
    throw notFound();
  }
}
