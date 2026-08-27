import { useState, type FormEvent } from "react";

import type { NaverAddressCandidate } from "@/integrations/naver/geocode.server";
import type { CurrentLocationResult } from "@/lib/geolocation/location-permission";

export const ShelterLocationSearch = ({
  searchAddress,
  requestLocation,
  onChooseLocation,
}: {
  searchAddress: (query: string) => Promise<readonly NaverAddressCandidate[]>;
  requestLocation: () => Promise<CurrentLocationResult>;
  onChooseLocation: (location: { latitude: number; longitude: number }) => void;
}) => {
  const [address, setAddress] = useState("");
  const [candidates, setCandidates] = useState<readonly NaverAddressCandidate[]>([]);
  const [state, setState] = useState<"IDLE" | "LOADING" | "ERROR">("IDLE");
  const [message, setMessage] = useState<string | null>(null);

  const handleCurrentLocation = async () => {
    const location = await requestLocation();
    if (location.kind !== "SUCCESS") {
      setMessage(
        location.kind === "RECENTLY_DENIED"
          ? "위치 요청은 24시간 동안 다시 표시하지 않습니다. 주소로 검색해 주세요."
          : "현재 위치를 사용할 수 없습니다. 주소로 검색해 주세요.",
      );
      return;
    }
    setMessage("현재 위치를 기준으로 쉼터를 찾았습니다.");
    onChooseLocation(location);
  };

  const submitAddress = async (event: FormEvent) => {
    event.preventDefault();
    if (address.trim().length < 2) {
      setState("ERROR");
      return;
    }
    setState("LOADING");
    try {
      const next = await searchAddress(address.trim());
      setCandidates(next);
      setState(next.length > 0 ? "IDLE" : "ERROR");
    } catch {
      setCandidates([]);
      setState("ERROR");
    }
  };

  const chooseAddress = (candidate: NaverAddressCandidate) => {
    setMessage(`${candidate.label} 기준으로 쉼터를 찾았습니다.`);
    setCandidates([]);
    onChooseLocation(candidate);
  };

  return (
    <section
      className="mt-6 rounded-xl border border-border bg-raised p-4 sm:p-6"
      aria-label="위치 검색"
    >
      <div className="grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
        <button
          type="button"
          onClick={() => void handleCurrentLocation()}
          className="t-body-s min-h-12 rounded-lg px-5 font-bold text-white"
          style={{ background: "var(--brand)" }}
        >
          내 위치로 찾기
        </button>
        <form
          onSubmit={(event) => void submitAddress(event)}
          className="grid gap-2 sm:grid-cols-[1fr_auto]"
        >
          <label className="sr-only" htmlFor="shelter-address">
            대구 주소 검색
          </label>
          <input
            id="shelter-address"
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
            placeholder="예: 대구 중구 국채보상로, 교동 119, 동대구역"
            className="t-body-s min-h-12 rounded-lg border border-border bg-background px-4"
          />
          <button
            type="submit"
            disabled={state === "LOADING"}
            className="t-body-s min-h-12 rounded-lg border border-brand px-5 font-bold text-brand disabled:opacity-60"
          >
            {state === "LOADING" ? "검색 중" : "주소 검색"}
          </button>
        </form>
      </div>
      {message ? (
        <p className="t-caption text-fg-2 mt-3" role="status">
          {message}
        </p>
      ) : null}
      {state === "ERROR" ? (
        <p className="t-caption mt-3" role="alert" style={{ color: "var(--heat-4)" }}>
          대구 안의 도로명, 지번 주소 또는 장소명(예: 교동 119, 동대구역)을 두 글자 이상 입력해
          주세요.
        </p>
      ) : null}
      {candidates.length > 0 ? (
        <ul className="mt-3 space-y-2" aria-label="주소 검색 후보">
          {candidates.map((candidate) => (
            <li key={`${candidate.longitude}:${candidate.latitude}:${candidate.label}`}>
              <button
                type="button"
                onClick={() => chooseAddress(candidate)}
                className="t-body-s min-h-12 w-full rounded-lg border border-border px-4 text-left hover:border-brand"
                aria-label={`${candidate.label} 선택`}
              >
                {candidate.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
