import { ExternalLink, MapPinned } from "lucide-react";
import { useId } from "react";

import { safeNaverMapUrl } from "./naver-map-url";

export function NaverMapLaunchNotice({ url }: { url: string | null }) {
  const descriptionId = useId();
  const href = safeNaverMapUrl(url);

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p id={descriptionId} className="t-caption flex gap-2 text-fg-2">
        <MapPinned aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand" />
        <span>
          선택하면 네이버 지도가 새 탭에서 열립니다. 돌아와도 이 화면의 후보 선택은 그대로
          유지됩니다.
        </span>
      </p>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          aria-describedby={descriptionId}
          className="mt-3 inline-flex min-h-[var(--tap-min)] w-full items-center justify-center gap-2 rounded-md bg-brand px-5 font-semibold text-white transition-[filter,transform] hover:brightness-95 active:scale-[.99]"
        >
          네이버 지도로 열기 (새 탭)
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      ) : (
        <p className="t-body-s mt-3 font-semibold text-danger">
          네이버 지도 연결 주소를 확인할 수 없습니다.
        </p>
      )}
    </div>
  );
}
