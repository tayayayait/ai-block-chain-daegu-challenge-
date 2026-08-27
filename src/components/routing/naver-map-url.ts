export function safeNaverMapUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "map.naver.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}
