import "@tanstack/react-start/server-only";

import {
  createKakaoLocalSearcher,
  type KakaoLocalSearcher,
} from "@/integrations/kakao/local.server";
import {
  createNaverGeocoder,
  type NaverAddressCandidate,
  type NaverGeocoder,
} from "@/integrations/naver/geocode.server";
import { createTmapPoiSearcher, type TmapPoiSearcher } from "@/integrations/tmap/poi.server";
import { getServerEnv } from "@/lib/env.server";

export interface SmartLocationSearcher {
  search(query: string): Promise<readonly NaverAddressCandidate[]>;
}

export function createSmartLocationSearcher(options: {
  kakaoApiKey?: string | undefined;
  naverClientId?: string | undefined;
  naverClientSecret?: string | undefined;
  tmapAppKey?: string | undefined;
  kakaoSearcher?: KakaoLocalSearcher | undefined;
  naverGeocoder?: NaverGeocoder | undefined;
  tmapSearcher?: TmapPoiSearcher | undefined;
}): SmartLocationSearcher {
  const kakaoSearcher =
    options.kakaoSearcher ??
    (options.kakaoApiKey ? createKakaoLocalSearcher({ apiKey: options.kakaoApiKey }) : null);

  const naverGeocoder =
    options.naverGeocoder ??
    (options.naverClientId && options.naverClientSecret
      ? createNaverGeocoder({
          clientId: options.naverClientId,
          clientSecret: options.naverClientSecret,
        })
      : null);

  const tmapSearcher =
    options.tmapSearcher ??
    (options.tmapAppKey ? createTmapPoiSearcher({ appKey: options.tmapAppKey }) : null);

  return {
    async search(query: string): Promise<readonly NaverAddressCandidate[]> {
      const trimmed = query.trim();
      if (trimmed.length < 2) return [];

      // 1. Primary: Kakao Local Search (Best-in-class for keywords, building names, POI and addresses)
      if (kakaoSearcher) {
        try {
          const kakaoResults = await kakaoSearcher.search(trimmed);
          if (kakaoResults.length > 0) {
            return kakaoResults;
          }
        } catch {
          // Fall through to other providers
        }
      }

      // 2. Secondary: NAVER Geocode (Standardized road/jibun addresses)
      if (naverGeocoder) {
        try {
          const naverResults = await naverGeocoder.search(trimmed);
          if (naverResults.length > 0) {
            return naverResults;
          }
        } catch {
          // Fall through
        }
      }

      // 3. Tertiary: TMAP POI Search
      if (tmapSearcher) {
        try {
          const tmapResults = await tmapSearcher.search(trimmed);
          if (tmapResults.length > 0) {
            return tmapResults;
          }
        } catch {
          // Fall through
        }
      }

      return [];
    },
  };
}

export function createSmartLocationSearcherFromEnv(): SmartLocationSearcher {
  const env = getServerEnv();

  return createSmartLocationSearcher({
    kakaoApiKey: env.KAKAO_REST_API_KEY,
    naverClientId: env.NAVER_MAPS_CLIENT_ID,
    naverClientSecret: env.NAVER_MAPS_CLIENT_SECRET,
    tmapAppKey: env.TMAP_APP_KEY,
  });
}
