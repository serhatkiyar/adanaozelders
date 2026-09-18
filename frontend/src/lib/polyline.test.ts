// @vitest-environment node
import { describe, expect, it } from "vitest";

import { decodePolyline, formatDuration } from "./polyline";

describe("decodePolyline", () => {
  it("Google'ın referans örneğini çözer", () => {
    // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ]);
  });

  it("boş girdide boş liste", () => {
    expect(decodePolyline("")).toEqual([]);
  });

  it("kesik girdide patlamaz, o ana kadarki noktaları döner", () => {
    const full = decodePolyline("_p~iF~ps|U_ulLnnqC");
    const truncated = decodePolyline("_p~iF~ps|U_ulLnn");
    expect(truncated.length).toBeLessThanOrEqual(full.length);
    expect(truncated[0]).toEqual([38.5, -120.2]);
  });
});

describe("formatDuration", () => {
  it("dakika ve saat biçimleri", () => {
    expect(formatDuration(45 * 60)).toBe("45 dk");
    expect(formatDuration(3600)).toBe("1 sa");
    expect(formatDuration(5100)).toBe("1 sa 25 dk");
  });
});
