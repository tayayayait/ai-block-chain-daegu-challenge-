import type { RiskLevel } from "@/lib/domain-types";
import { levelOf } from "@/lib/risk/hri";
import { LEVEL_LABEL } from "@/lib/risk/presentation";

const STOPS: { level: RiskLevel; color: string }[] = [
  { level: "L0", color: "var(--heat-0)" },
  { level: "L1", color: "var(--heat-1)" },
  { level: "L2", color: "var(--heat-2)" },
  { level: "L3", color: "var(--heat-3)" },
  { level: "L4", color: "var(--heat-4)" },
];

type Variant = "full" | "inline" | "legend";

/** 등온 리본(Isotherm Ribbon) — 5단계 열 스케일 + 현재 위치 마커 */
export function IsothermRibbon({
  score,
  variant = "full",
  showLabels = false,
  className = "",
}: {
  score: number;
  variant?: Variant;
  showLabels?: boolean;
  className?: string;
}) {
  const h = variant === "full" ? 12 : variant === "legend" ? 8 : 6;
  const width = variant === "inline" ? 120 : variant === "legend" ? 200 : undefined;
  const level = levelOf(score);

  return (
    <div
      className={className}
      style={width ? { width } : undefined}
      role="img"
      aria-label={`위험도 ${score}점, ${level} ${LEVEL_LABEL[level]}`}
    >
      {showLabels && (
        <div className="t-caption mb-1 flex justify-between text-fg-2">
          {STOPS.map((s) => (
            <span key={s.level}>{LEVEL_LABEL[s.level]}</span>
          ))}
        </div>
      )}
      <div className="relative">
        <div className="flex overflow-hidden rounded-sm" style={{ height: h }}>
          {STOPS.map((s) => (
            <div key={s.level} className="flex-1" style={{ backgroundColor: s.color }} />
          ))}
        </div>
        <div
          className="absolute top-0"
          style={{
            left: 0,
            transform: `translateX(calc(${Math.min(100, Math.max(0, score))}% - 5px))`,
            transition: "transform 240ms cubic-bezier(.2,.8,.2,1)",
          }}
        >
          <div
            className="border-background bg-foreground rounded-full border-2"
            style={{ width: 10, height: h + 6, marginTop: -3 }}
          />
        </div>
      </div>
      {variant === "full" && (
        <div className="t-caption text-fg-2 mt-2 flex justify-between">
          <span>0</span>
          <span className="num text-foreground font-bold">
            현재 {score} · {level} {LEVEL_LABEL[level]}
          </span>
          <span>100</span>
        </div>
      )}
    </div>
  );
}

/** 카드 좌측 4px 세로 인디케이터 */
export function LevelBar({ level }: { level: RiskLevel }) {
  return (
    <span
      aria-hidden="true"
      className="absolute top-0 bottom-0 left-0 w-1 rounded-l-lg"
      style={{ backgroundColor: `var(--heat-${level.slice(1)})` }}
    />
  );
}
