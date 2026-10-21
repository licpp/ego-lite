import test from "node:test";
import assert from "node:assert/strict";
import { fillDate } from "../../../skills/ego-browser/scripts/form-helpers.mjs";

function fakeDate({
  value = "",
  readOnly = true,
  type = "text",
  precision = "day",
  year = 2026,
  month = 10,
  blockedDay,
  stop,
  rejectCommit = false,
} = {}) {
  const calls = [];
  let view =
    precision === "day" ? "days" : precision === "month" ? "months" : "years";
  let decade = Math.floor(year / 10) * 10;
  let open = false;
  let typed;
  const cell = (selector, value, disabled = false) => ({
    selector,
    value,
    disabled,
  });
  const snapshot = () => ({
    view,
    year,
    month,
    yearLabel: cell("year-header"),
    monthLabel: cell("month-header"),
    previous: cell("prev"),
    next: cell("next"),
    years: Array.from({ length: 10 }, (_, i) =>
      cell("year:" + (decade + i), decade + i),
    ),
    months: Array.from({ length: 12 }, (_, i) =>
      cell("month:" + (i + 1), i + 1),
    ),
    days: Array.from({ length: 31 }, (_, i) =>
      cell("day:" + (i + 1), i + 1, i + 1 === blockedDay),
    ),
  });
  const commit = () => {
    if (!rejectCommit)
      value = [year, month, 22]
        .slice(0, precision === "day" ? 3 : precision === "month" ? 2 : 1)
        .map((p, i) => (i ? String(p).padStart(2, "0") : p))
        .join("/");
    open = false;
  };
  return {
    calls,
    page: {
      async evaluate(fn, arg) {
        if (arg.read === "input")
          return { value, readOnly, type, disabled: false };
        if (arg.read === "panels") return { count: Number(open) };
        return snapshot();
      },
      async fill(selector, text) {
        calls.push(["fill", selector, text]);
        typed = text;
      },
      async press(selector, key) {
        calls.push(["press", key]);
        if (!rejectCommit) value = typed;
      },
      async click(selector) {
        calls.push(["click", selector]);
        if (stop) throw stop;
        if (selector === "#date") open = true;
        else if (selector === "year-header") view = "years";
        else if (selector === "month-header") view = "months";
        else if (selector === "prev") decade -= 10;
        else if (selector === "next") decade += 10;
        else if (selector.startsWith("year:")) {
          year = Number(selector.split(":")[1]);
          view = "months";
          if (precision === "year") commit();
        } else if (selector.startsWith("month:")) {
          month = Number(selector.split(":")[1]);
          view = "days";
          if (precision === "month") commit();
        } else if (selector.startsWith("day:")) {
          commit();
        }
      },
      async waitForFunction(fn, arg) {
        if (arg.expected && typeof arg.expected === "string") {
          assert.equal(
            value.replaceAll("/", "-"),
            arg.expected,
            "only a committed value can succeed",
          );
        } else {
          assert.equal(open, true);
          const expected = arg.expected;
          if (expected.view) assert.equal(view, expected.view);
          if (expected.year) assert.equal(year, expected.year);
          if (expected.month) assert.equal(month, expected.month);
          if (expected.differentFirstYear !== undefined)
            assert.notEqual(decade, expected.differentFirstYear);
        }
      },
    },
  };
}

test("date helper fills editable native/text inputs once, commits and skips already-correct values", async () => {
  for (const [type, expected] of [
    ["date", "2024-02-29"],
    ["text", "2024/02/29"],
  ]) {
    const { page, calls } = fakeDate({ readOnly: false, type });
    assert.equal((await fillDate(page, "#date", "2024-02-29")).changed, true);
    assert.equal(calls[0][2], expected);
    assert.deepEqual(calls.at(-1), ["press", "Tab"]);
  }
  const { page, calls } = fakeDate({ value: "2024/2/29" });
  assert.equal((await fillDate(page, "#date", "2024-02-29")).changed, false);
  assert.equal(calls.length, 0);
});

test("read-only date helper jumps decades then selects the exact year/month/day", async () => {
  const { page, calls } = fakeDate();
  const result = await fillDate(page, "#date", "1973-02-22");
  assert.equal(result.date, "1973-02-22");
  assert.equal(calls.filter((c) => c[1] === "prev").length, 5);
  assert.deepEqual(calls.slice(-3), [
    ["click", "year:1973"],
    ["click", "month:2"],
    ["click", "day:22"],
  ]);
});

test("month/year precision and a date in the current month avoid unnecessary navigation", async () => {
  for (const [precision, value, last] of [
    ["month", "2025-12", "month:12"],
    ["year", "2027", "year:2027"],
    ["day", "2026-10-22", "day:22"],
  ]) {
    const { page, calls } = fakeDate({ precision });
    assert.equal((await fillDate(page, "#date", value)).date, value);
    assert.equal(calls.at(-1)[1], last);
    if (value === "2026-10-22") assert.equal(calls.length, 2);
  }
});

test("invalid dates/options are rejected before browser work; disabled dates and hard stops are not retried", async () => {
  const untouched = {
    evaluate() {
      throw new Error("should not observe");
    },
  };
  for (const value of [
    "2025-02-29",
    "1900-02-29",
    "2026-04-31",
    "2026-00",
    "0000",
    "2026-13",
    "2026-01-00",
    "2026-1-1",
  ])
    await assert.rejects(() => fillDate(untouched, "#date", value), TypeError);
  await assert.rejects(
    () => fillDate(untouched, "#date", "2026-01", { format: "YYYY/MM/DD" }),
    TypeError,
  );
  await assert.rejects(
    () => fillDate(untouched, "#date", "2026-01", { mode: "hack" }),
    TypeError,
  );
  const blocked = fakeDate({ blockedDay: 22 });
  await assert.rejects(
    () => fillDate(blocked.page, "#date", "2026-10-22"),
    /disabled/,
  );
  assert.ok(!blocked.calls.some((c) => c[1] === "day:22"));
  const stop = new Error("user control hard stop");
  const stopped = fakeDate({ stop });
  await assert.rejects(
    () => fillDate(stopped.page, "#date", "2026-10-22"),
    (e) => e === stop,
  );
  assert.equal(stopped.calls.length, 1);
  const rejected = fakeDate({ readOnly: false, rejectCommit: true });
  await assert.rejects(
    () => fillDate(rejected.page, "#date", "2026-10-22"),
    /committed/,
  );
});
