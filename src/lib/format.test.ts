import { describe, expect, it } from "vitest";

import { shortHash } from "./format";

describe("shortHash", () => {
  it("12자 이하 문자열은 그대로 표시한다", () => {
    expect(shortHash("0x1234567890")).toBe("0x1234567890");
  });

  it("긴 해시는 앞 6자와 뒤 4자만 표시한다", () => {
    expect(shortHash("0x1234567890abcdef")).toBe("0x1234…cdef");
  });
});
