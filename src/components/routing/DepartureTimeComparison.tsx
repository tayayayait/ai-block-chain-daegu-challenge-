import {
  Clock3,
  Footprints,
  Pause,
  Play,
  Sparkles,
  SunMedium,
  ThermometerSun,
  Trees,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { DEPARTURE_TIMELINE_MAX_MINUTES, getDepartureTimelineFrame } from "./departure-timeline";
import type { DepartureComparisonUiDto, RoutePlanUiDto } from "./route-ui-dto";

const PLAYBACK_MINUTES_PER_MILLISECOND = 1 / 800;
const SHADOW_SYNC_INTERVAL_MS = 80;
const MAX_ANIMATION_FRAME_DELTA_MS = 100;

function formatDepartureTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "시각 확인 지연";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function formatOffset(offsetMinutes: number): string {
  const displayMinutes = Math.floor(offsetMinutes);
  if (displayMinutes <= 0) return "지금";
  if (offsetMinutes >= DEPARTURE_TIMELINE_MAX_MINUTES) return "1시간 후";
  return `${displayMinutes}분 후`;
}

function reducedMotionRequested(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function DepartureTimeComparison({
  comparison,
  selectedOffsetMinutes,
  onSelect,
}: {
  comparison: DepartureComparisonUiDto;
  selectedOffsetMinutes: number;
  onSelect: (offsetMinutes: number, plan: RoutePlanUiDto) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackOffsetMinutes, setPlaybackOffsetMinutes] = useState(
    () => getDepartureTimelineFrame(comparison, selectedOffsetMinutes).offsetMinutes,
  );
  const autoplayStartedRef = useRef(false);
  const playbackOffsetRef = useRef(playbackOffsetMinutes);
  const onSelectRef = useRef(onSelect);
  const controlledFrame = useMemo(
    () => getDepartureTimelineFrame(comparison, selectedOffsetMinutes),
    [comparison, selectedOffsetMinutes],
  );
  const renderedOffsetMinutes = isPlaying ? playbackOffsetMinutes : controlledFrame.offsetMinutes;
  const frame = useMemo(
    () => getDepartureTimelineFrame(comparison, renderedOffsetMinutes),
    [comparison, renderedOffsetMinutes],
  );
  const recommendedFrame = useMemo(
    () => getDepartureTimelineFrame(comparison, comparison.recommendedOffsetMinutes),
    [comparison],
  );
  const progressPercent = (frame.offsetMinutes / DEPARTURE_TIMELINE_MAX_MINUTES) * 100;
  const recommendedPercent =
    (recommendedFrame.offsetMinutes / DEPARTURE_TIMELINE_MAX_MINUTES) * 100;

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (autoplayStartedRef.current) return;
    autoplayStartedRef.current = true;
    if (selectedOffsetMinutes < DEPARTURE_TIMELINE_MAX_MINUTES && !reducedMotionRequested()) {
      playbackOffsetRef.current = controlledFrame.offsetMinutes;
      setPlaybackOffsetMinutes(controlledFrame.offsetMinutes);
      setIsPlaying(true);
    }
  }, [controlledFrame.offsetMinutes, selectedOffsetMinutes]);

  useEffect(() => {
    if (!isPlaying) return;
    if (playbackOffsetRef.current >= DEPARTURE_TIMELINE_MAX_MINUTES) {
      setIsPlaying(false);
      return;
    }
    let animationFrameId = 0;
    let previousTimestamp: number | null = null;
    let lastShadowSyncTimestamp: number | null = null;

    const animate = (timestamp: number) => {
      if (previousTimestamp === null) {
        previousTimestamp = timestamp;
        lastShadowSyncTimestamp = timestamp;
        animationFrameId = window.requestAnimationFrame(animate);
        return;
      }

      const elapsedMilliseconds = Math.min(
        MAX_ANIMATION_FRAME_DELTA_MS,
        Math.max(0, timestamp - previousTimestamp),
      );
      previousTimestamp = timestamp;
      const nextOffset = Math.min(
        DEPARTURE_TIMELINE_MAX_MINUTES,
        playbackOffsetRef.current + elapsedMilliseconds * PLAYBACK_MINUTES_PER_MILLISECOND,
      );
      const roundedOffset = Number(nextOffset.toFixed(4));
      playbackOffsetRef.current = roundedOffset;
      setPlaybackOffsetMinutes(roundedOffset);

      const shouldSyncShadow =
        lastShadowSyncTimestamp === null ||
        timestamp - lastShadowSyncTimestamp >= SHADOW_SYNC_INTERVAL_MS ||
        roundedOffset >= DEPARTURE_TIMELINE_MAX_MINUTES;
      if (shouldSyncShadow) {
        const nextFrame = getDepartureTimelineFrame(comparison, roundedOffset);
        onSelectRef.current(nextFrame.offsetMinutes, nextFrame.plan);
        lastShadowSyncTimestamp = timestamp;
      }

      if (roundedOffset >= DEPARTURE_TIMELINE_MAX_MINUTES) {
        setIsPlaying(false);
        return;
      }
      animationFrameId = window.requestAnimationFrame(animate);
    };

    animationFrameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [comparison, isPlaying]);

  const selectOffset = (offsetMinutes: number) => {
    const nextFrame = getDepartureTimelineFrame(comparison, offsetMinutes);
    playbackOffsetRef.current = nextFrame.offsetMinutes;
    setPlaybackOffsetMinutes(nextFrame.offsetMinutes);
    onSelectRef.current(nextFrame.offsetMinutes, nextFrame.plan);
  };

  const togglePlayback = () => {
    if (isPlaying) {
      selectOffset(playbackOffsetRef.current);
      setIsPlaying(false);
      return;
    }
    if (frame.offsetMinutes >= DEPARTURE_TIMELINE_MAX_MINUTES) selectOffset(0);
    else {
      playbackOffsetRef.current = frame.offsetMinutes;
      setPlaybackOffsetMinutes(frame.offsetMinutes);
    }
    setIsPlaying(true);
  };

  const dataUnavailable = frame.feelsLikeC === null && frame.shadePercent === null;
  const currentTime = formatDepartureTime(frame.departureAt);
  const recommendedTime = formatDepartureTime(recommendedFrame.departureAt);
  const isRecommended = Math.abs(frame.offsetMinutes - recommendedFrame.offsetMinutes) < 0.05;

  return (
    <section
      aria-labelledby="departure-comparison-heading"
      className="overflow-hidden rounded-2xl border border-border bg-raised shadow-sh-1"
    >
      <header className="relative border-b border-border px-5 py-5 sm:px-6">
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-64 bg-[radial-gradient(circle_at_right,color-mix(in_oklab,var(--heat-1)_20%,transparent),transparent_68%)]"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-sh-1">
              <Clock3 className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="t-caption font-bold text-brand">1시간 더위 타임라인</p>
              <h2 id="departure-comparison-heading" className="t-h2 mt-1">
                언제 출발하면 덜 더울까요?
              </h2>
              <p className="t-caption mt-1 text-fg-2">
                현재부터 1시간 뒤까지, 지도 그림자와 더위 지표를 연속해서 재생합니다.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-border bg-overlay/90 px-3 py-1.5 shadow-sh-1 backdrop-blur">
            <span
              className={`size-2 rounded-full ${isPlaying ? "animate-pulse bg-brand" : "bg-fg-3"}`}
              aria-hidden="true"
            />
            <span className="t-caption font-bold text-fg-2">
              {isPlaying ? "지도와 함께 재생 중" : "선택 시각에서 멈춤"}
            </span>
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)]">
        <div className="relative isolate min-h-56 overflow-hidden bg-[linear-gradient(145deg,var(--foreground),color-mix(in_oklab,var(--foreground)_82%,var(--brand)))] px-5 py-6 text-background sm:px-6">
          <div
            className="absolute -top-20 -right-16 size-56 rounded-full border border-white/10"
            aria-hidden="true"
          />
          <div
            className="absolute top-1/2 -right-16 size-48 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--heat-1)_48%,transparent),transparent_68%)] blur-xl"
            aria-hidden="true"
          />

          <div className="relative flex h-full flex-col justify-between gap-8">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="t-caption font-bold text-background/65">선택 출발 시각</p>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-background/80">
                  {formatOffset(frame.offsetMinutes)}
                </span>
                {isRecommended ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-extrabold text-white">
                    <Sparkles className="size-3" aria-hidden="true" />
                    추천 시각
                  </span>
                ) : null}
              </div>
              <p
                className="num mt-3 text-[clamp(3.1rem,8vw,5.2rem)] leading-none font-black tracking-[-0.06em] tabular-nums"
                aria-live={isPlaying ? "off" : "polite"}
              >
                {currentTime}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="t-caption max-w-52 text-background/65">
                시간이 흐르면 지도 위 건물 그림자의 위치와 범위도 함께 이동합니다.
              </p>
              <span className="num shrink-0 text-xs font-bold text-background/55">
                {String(Math.floor(frame.offsetMinutes)).padStart(2, "0")} / 60 MIN
              </span>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="t-body-s font-extrabold">이 시각에 출발하면</p>
            <span className="t-caption inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_oklab,var(--brand)_9%,var(--raised))] px-2.5 py-1 font-bold text-brand">
              <Sparkles className="size-3.5" aria-hidden="true" />
              추천 {recommendedTime}
            </span>
          </div>

          {dataUnavailable ? (
            <div className="mt-5 rounded-xl border border-dashed border-border bg-background p-5">
              <p className="t-body-s font-semibold text-fg-2">예보·그늘 확인 지연</p>
            </div>
          ) : (
            <dl className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-background p-4">
                <dt className="t-caption flex items-center gap-2 font-bold text-fg-2">
                  <ThermometerSun className="size-4 text-heat-2" aria-hidden="true" />
                  체감온도
                </dt>
                <dd className="num mt-3 text-lg font-extrabold tabular-nums">
                  {frame.feelsLikeC === null
                    ? "확인 지연"
                    : `체감 ${frame.feelsLikeC.toFixed(1)}°C`}
                </dd>
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <dt className="t-caption flex items-center gap-2 font-bold text-fg-2">
                  <Trees className="size-4 text-brand" aria-hidden="true" />
                  그늘 비율
                </dt>
                <dd className="num mt-3 text-lg font-extrabold tabular-nums">
                  {frame.shadePercent === null
                    ? "확인 지연"
                    : `그늘 ${Math.round(frame.shadePercent)}%`}
                </dd>
              </div>
              <div className="rounded-xl border border-border bg-background p-4">
                <dt className="t-caption flex items-center gap-2 font-bold text-fg-2">
                  <SunMedium className="size-4 text-heat-1" aria-hidden="true" />
                  직사광선
                </dt>
                <dd className="num mt-3 text-lg font-extrabold tabular-nums">
                  {frame.directSunMinutes === null
                    ? "확인 지연"
                    : `직사광선 약 ${Math.round(frame.directSunMinutes)}분`}
                </dd>
              </div>
            </dl>
          )}

          <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-fg-2">
            <Footprints className="size-4 shrink-0 text-brand" aria-hidden="true" />
            <p className="t-caption">
              도보 {Math.round(frame.walkingMinutes)}분
              {Math.round(frame.additionalWalkingMinutes) > 0
                ? ` · 최단보다 ${Math.round(frame.additionalWalkingMinutes)}분 추가`
                : " · 추가 이동 없음"}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-background px-5 py-5 sm:px-6">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={togglePlayback}
            aria-label={isPlaying ? "일시정지" : "재생"}
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-sh-2 transition hover:-translate-y-0.5 hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand active:translate-y-0"
          >
            {isPlaying ? (
              <Pause className="size-5 fill-current" aria-hidden="true" />
            ) : (
              <Play className="ml-0.5 size-5 fill-current" aria-hidden="true" />
            )}
          </button>

          <div className="min-w-0 flex-1">
            <div className="relative h-9">
              <div
                className="absolute top-1/2 right-0 left-0 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-border"
                aria-hidden="true"
              >
                <span
                  className="block h-full rounded-full bg-[linear-gradient(90deg,var(--brand),var(--heat-1))]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span
                className="pointer-events-none absolute top-1/2 z-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-heat-1 shadow-sh-1"
                style={{ left: `${recommendedPercent}%` }}
                aria-hidden="true"
              />
              <input
                type="range"
                min={0}
                max={DEPARTURE_TIMELINE_MAX_MINUTES}
                step={0.1}
                value={frame.offsetMinutes}
                onChange={(event) => {
                  setIsPlaying(false);
                  selectOffset(Number(event.currentTarget.value));
                }}
                aria-label="출발 시각"
                aria-valuetext={`${currentTime} 출발, ${formatOffset(frame.offsetMinutes)}`}
                className="absolute inset-0 z-20 h-9 w-full cursor-pointer appearance-none bg-transparent focus-visible:rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand [&::-moz-range-thumb]:size-7 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-background [&::-moz-range-thumb]:bg-brand [&::-moz-range-thumb]:shadow-sh-2 [&::-moz-range-track]:h-2 [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:-mt-2.5 [&::-webkit-slider-thumb]:size-7 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-brand [&::-webkit-slider-thumb]:shadow-sh-2"
              />
            </div>
            <div className="t-caption mt-1 grid grid-cols-3 text-fg-3">
              <span>지금</span>
              <span className="text-center">+30분</span>
              <span className="text-right">+1시간</span>
            </div>
          </div>
        </div>
      </div>

      <p className="t-caption border-t border-border bg-raised px-5 py-3 text-fg-2 sm:px-6">
        0·30·60분 분석값 사이를 연속 보간합니다. 추천은 체감온도 50%·직사광선 35%·이동시간 15%를
        반영합니다.
      </p>
    </section>
  );
}
