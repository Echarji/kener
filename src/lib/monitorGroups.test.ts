import { describe, expect, it } from "vitest";
import { CountMemberStatuses, GroupDisplayOf, ParseStoredGroupViews, SummarizeMemberStatuses } from "./monitorGroups";

describe("a group's members display", () => {
  it("reads the layout and style the group chose", () => {
    expect(GroupDisplayOf({ membersLayout: "grid", membersStyle: "simple" })).toEqual({
      layout: "grid",
      style: "simple",
    });
    expect(GroupDisplayOf({ membersLayout: "list", membersStyle: "compact" })).toEqual({
      layout: "list",
      style: "compact",
    });
  });

  it("is a compact list for a group that has not chosen, or chose something unknown", () => {
    expect(GroupDisplayOf({})).toEqual({ layout: "list", style: "compact" });
    expect(GroupDisplayOf(null)).toEqual({ layout: "list", style: "compact" });
    expect(GroupDisplayOf({ membersLayout: "table", membersStyle: "huge" })).toEqual({
      layout: "list",
      style: "compact",
    });
    expect(GroupDisplayOf({ membersLayout: "grid" })).toEqual({ layout: "grid", style: "compact" });
  });
});

describe("the layouts visitors picked", () => {
  it("are read back per group, keeping only valid ones", () => {
    expect(ParseStoredGroupViews('{"checkout":"grid","search":"list","api":"table"}')).toEqual({
      checkout: "grid",
      search: "list",
    });
  });

  it("are empty when nothing usable was stored", () => {
    expect(ParseStoredGroupViews(null)).toEqual({});
    expect(ParseStoredGroupViews("not json")).toEqual({});
    expect(ParseStoredGroupViews('["grid"]')).toEqual({});
  });
});

describe("a group's member summary", () => {
  it("counts the members whose status has loaded", () => {
    expect(CountMemberStatuses(["UP", "UP", "DOWN", "DEGRADED", undefined, null, "MAINTENANCE"])).toEqual({
      UP: 2,
      DOWN: 1,
      DEGRADED: 1,
      MAINTENANCE: 1,
      NO_DATA: 0,
      total: 5,
    });
  });

  it("lists the statuses worst first, leaving out the ones no member is in", () => {
    const counts = CountMemberStatuses(["UP", "DEGRADED", "UP", "DOWN", "NO_DATA"]);

    expect(SummarizeMemberStatuses(counts)).toEqual([
      { status: "DOWN", count: 1 },
      { status: "DEGRADED", count: 1 },
      { status: "UP", count: 2 },
      { status: "NO_DATA", count: 1 },
    ]);
  });

  it("is a single entry when every member is up", () => {
    expect(SummarizeMemberStatuses(CountMemberStatuses(["UP", "UP", "UP"]))).toEqual([{ status: "UP", count: 3 }]);
  });
});
