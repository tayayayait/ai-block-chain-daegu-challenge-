import type { ReactNode } from "react";

import type { RiskLevel } from "@/lib/domain-types";

import { RiskBadge } from "./Badges";
import { LevelBar } from "./Ribbon";

export interface RiskCardSubject {
  maskedName: string;
  age: number;
  livesAlone: boolean;
}

export interface RiskCardProps {
  level: RiskLevel;
  score: number;
  subject: RiskCardSubject;
  feelsLikeC: number;
  location: string;
  reasons: readonly string[];
  action?: ReactNode;
  surface?: "shade" | "paper";
  className?: string;
}

export function RiskCard({
  level,
  score,
  subject,
  feelsLikeC,
  location,
  reasons,
  action,
  surface = "shade",
  className = "",
}: RiskCardProps) {
  const isImmediateDanger = level === "L4";

  return (
    <article
      aria-label={`${subject.maskedName} 위험도`}
      data-level={level}
      data-surface={surface}
      data-alert-pulse={isImmediateDanger ? "true" : undefined}
      className={`bg-raised border-border relative overflow-hidden rounded-lg border p-4 transition-[border-color,box-shadow] duration-100 hover:border-brand sm:p-6 ${
        surface === "paper" ? "shadow-sh-1 hover:shadow-sh-2" : ""
      } ${isImmediateDanger ? "pulse-l4 border-heat-4" : ""} ${className}`}
    >
      <LevelBar level={level} />

      <header className="flex flex-wrap items-start justify-between gap-3 pl-1">
        <RiskBadge level={level} />
        <p className="t-body-s text-fg-2">
          {subject.maskedName} · <span className="num">{subject.age}</span>세 ·{" "}
          {subject.livesAlone ? "독거" : "동거"}
        </p>
      </header>

      <div className="mt-5 flex flex-wrap items-end gap-x-5 gap-y-1 pl-1">
        <strong className="t-data-xl num" aria-label={`HRI ${score}점`}>
          {score}
        </strong>
        <p className="t-body-s text-fg-2 pb-1">
          체감 <span className="num">{feelsLikeC.toFixed(1)}</span>℃ · {location}
        </p>
      </div>

      {reasons.length > 0 ? (
        <ul className="t-body-s text-fg-2 mt-5 space-y-1.5 pl-1">
          {reasons.slice(0, 3).map((reason) => (
            <li key={reason} className="flex gap-2">
              <span aria-hidden="true">·</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {action ? <div className="mt-5 pl-1">{action}</div> : null}
    </article>
  );
}
