import { describe, expect, it } from "vitest";
import { DemandStatus, ReportStatus } from "@/types";
import { parseAdminAuditQuery, parseAdminBookingQuery, parseAdminDemandQuery, parseAdminReportQuery } from "./adminOperationsQuery";

describe("admin operations query state", () => {
  it("parses safe audit paging, filters and sorting", () => {
    const state = parseAdminAuditQuery(
      new URLSearchParams("page=3&limit=50&q=booking&actor=7&target=order&sort=action&order=asc")
    );
    expect(state).toMatchObject({
      page: 3,
      pageSize: 50,
      q: "booking",
      actorId: 7,
      targetType: "order",
      sort: "action",
      order: "asc",
    });
  });

  it("falls back from invalid audit values", () => {
    const state = parseAdminAuditQuery(new URLSearchParams("page=-1&limit=200&actor=x&sort=nope"));
    expect(state).toMatchObject({ page: 1, pageSize: 25, actorId: undefined, sort: "created_at" });
  });

  it("defaults reports to the open queue and accepts a terminal filter", () => {
    expect(parseAdminReportQuery(new URLSearchParams()).status).toBe(ReportStatus.OPEN);
    expect(parseAdminReportQuery(new URLSearchParams("status=RESOLVED")).status).toBe(ReportStatus.RESOLVED);
  });

  it("keeps demand filters and sorting in a safe URL state", () => {
    expect(parseAdminDemandQuery(new URLSearchParams("page=2&limit=50&q=matematik&status=OPEN&sort=response_count&order=asc"))).toMatchObject({
      page: 2,
      pageSize: 50,
      q: "matematik",
      status: DemandStatus.OPEN,
      sort: "response_count",
      order: "asc",
    });
    expect(parseAdminDemandQuery(new URLSearchParams("status=INVALID&sort=nope"))).toMatchObject({
      status: undefined,
      sort: "created_at",
      order: "desc",
    });
  });

  it("parses booking status, dispute and server sorting", () => {
    expect(parseAdminBookingQuery(new URLSearchParams("status=ACCEPTED&disputed=true&sort=start_at&order=asc&page=4"))).toMatchObject({
      page: 4,
      status: "ACCEPTED",
      isDisputed: true,
      sort: "start_at",
      order: "asc",
    });
    expect(parseAdminBookingQuery(new URLSearchParams("status=nope&disputed=nope&sort=nope"))).toMatchObject({
      status: undefined,
      isDisputed: undefined,
      sort: "created_at",
    });
  });
});
