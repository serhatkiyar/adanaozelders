// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseAdminUserQuery, setQueryValue } from "./adminUserQuery";

describe("admin user query state", () => {
  it("uses safe defaults for invalid URL state", () => {
    const state = parseAdminUserQuery(new URLSearchParams("page=-2&limit=999&role=ROOT&sort=password"));
    expect(state).toEqual({
      page: 1,
      pageSize: 25,
      q: "",
      role: undefined,
      isActive: undefined,
      sort: "created_at",
      order: "desc",
    });
  });

  it("parses supported filters and sorting", () => {
    const state = parseAdminUserQuery(new URLSearchParams("page=3&limit=50&q=ali&role=TUTOR&active=false&sort=full_name&order=asc"));
    expect(state.page).toBe(3);
    expect(state.pageSize).toBe(50);
    expect(state.role).toBe("TUTOR");
    expect(state.isActive).toBe(false);
    expect(state.sort).toBe("full_name");
    expect(state.order).toBe("asc");
  });

  it("preserves unrelated values while changing filters", () => {
    const next = setQueryValue(new URLSearchParams("q=ali&page=4"), { role: "CLIENT", page: 1, q: undefined });
    expect(next.toString()).toBe("page=1&role=CLIENT");
  });
});
