import type { ReactElement, ReactNode } from "react";

import { toPublicErrorDto, type PublicErrorDto } from "@/lib/error-dto";
import { cn } from "@/lib/utils";
import type { AsyncState as AsyncStatus } from "@/lib/domain-types";

import { Btn } from "./Btn";

export interface EmptyStateProps {
  title: string;
  description: string;
  action: ReactElement;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <section
      className={cn(
        "border-border bg-raised flex flex-col items-center gap-3 rounded-lg border p-6 text-center",
        className,
      )}
    >
      <h2 className="t-h3 text-fg break-words">{title}</h2>
      <p className="t-body-s text-fg-2 max-w-prose break-words">{description}</p>
      <div className="mt-1">{action}</div>
    </section>
  );
}

interface ErrorStateBaseProps {
  className?: string;
}

type ErrorStateRecoveryProps =
  | {
      error: Extract<PublicErrorDto, { retryable: true }>;
      onRetry: () => void;
      retrying?: boolean;
      action?: never;
    }
  | {
      error: Extract<PublicErrorDto, { retryable: false }>;
      onRetry?: never;
      retrying?: never;
      action: ReactElement;
    };

export type ErrorStateProps = ErrorStateBaseProps & ErrorStateRecoveryProps;

export function ErrorState({
  error,
  className,
  onRetry,
  retrying = false,
  action,
}: ErrorStateProps) {
  const safeError = toPublicErrorDto(error);
  const canRetry = safeError.retryable && typeof onRetry === "function";

  return (
    <section
      role="alert"
      className={cn("border-danger/40 bg-raised rounded-lg border p-5", className)}
    >
      <h2 className="t-h3 text-danger break-words">요청을 처리하지 못했습니다</h2>
      <p className="t-body-s text-fg-2 mt-2 break-words">{safeError.userMessage}</p>
      <div className="mt-4">
        {canRetry ? (
          <Btn type="button" variant="secondary" loading={retrying} onClick={onRetry}>
            다시 시도
          </Btn>
        ) : (
          action
        )}
      </div>
    </section>
  );
}

export interface PartialDataBannerProps {
  missingSources: readonly [string, ...string[]];
  lastSuccessfulAtLabel: string;
  className?: string;
}

export function PartialDataBanner({
  missingSources,
  lastSuccessfulAtLabel,
  className,
}: PartialDataBannerProps) {
  return (
    <div
      role="status"
      aria-label="부분 데이터 안내"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "border-heat-1 bg-raised text-fg t-body-s rounded-md border px-4 py-3 break-words",
        className,
      )}
    >
      {missingSources.join(" · ")} 데이터를 불러오지 못해 {lastSuccessfulAtLabel} 기준 값을
      표시합니다.
    </div>
  );
}

export interface RefreshingIndicatorProps {
  label?: string;
  className?: string;
}

export function RefreshingIndicator({ label = "갱신 중…", className }: RefreshingIndicatorProps) {
  return (
    <span
      role="status"
      aria-label="데이터 갱신 상태"
      aria-live="polite"
      aria-atomic="true"
      className={cn("text-fg-2 t-body-s inline-flex items-center gap-2", className)}
    >
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      {label}
    </span>
  );
}

export interface AsyncStateProps {
  state: AsyncStatus;
  children: ReactNode;
  loadingFallback: ReactNode;
  emptyFallback: ReactNode;
  errorFallback: ReactNode;
  partialBanner: ReactNode;
  refreshingIndicator?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

export function AsyncState({
  state,
  children,
  loadingFallback,
  emptyFallback,
  errorFallback,
  partialBanner,
  refreshingIndicator = <RefreshingIndicator />,
  ariaLabel = "비동기 데이터 영역",
  className,
}: AsyncStateProps) {
  const isLoading = state === "idle" || state === "loading";

  if (isLoading) {
    return (
      <section
        role="region"
        aria-label={ariaLabel}
        aria-busy={state === "loading" ? true : undefined}
        data-state={state}
        className={className}
      >
        <div aria-hidden="true">{loadingFallback}</div>
      </section>
    );
  }

  if (state === "empty") {
    return (
      <section role="region" aria-label={ariaLabel} data-state={state} className={className}>
        {emptyFallback}
      </section>
    );
  }

  if (state === "error") {
    return (
      <section role="region" aria-label={ariaLabel} data-state={state} className={className}>
        {errorFallback}
      </section>
    );
  }

  return (
    <section
      role="region"
      aria-label={ariaLabel}
      data-state={state}
      className={cn("relative", className)}
    >
      {state === "partial" ? <div key="partial-banner">{partialBanner}</div> : null}
      {state === "refreshing" ? (
        <div key="refreshing-indicator" className="mb-2 flex justify-end">
          {refreshingIndicator}
        </div>
      ) : null}
      <div key="content">{children}</div>
    </section>
  );
}
