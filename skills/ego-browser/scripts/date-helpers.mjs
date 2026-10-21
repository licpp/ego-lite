/** Set a CSS-selected date input using native Page actions, never DOM value setters. */
export async function fillDate(page, selector, value, options = {}) {
  if (typeof selector !== "string" || !selector.trim())
    throw new TypeError("selector must be a CSS selector for one input");
  const target = parseDate(value);
  const { mode = "auto", format, timeout = 10000 } = options;
  if (
    Object.keys(options).some(
      (key) => !["mode", "format", "timeout"].includes(key),
    ) ||
    !["auto", "input", "picker"].includes(mode) ||
    !Number.isFinite(timeout) ||
    timeout <= 0
  )
    throw new TypeError(
      "date options: mode auto/input/picker, optional format and positive timeout",
    );
  const formats = target.day
    ? ["YYYY/MM/DD", "YYYY-MM-DD"]
    : target.month
      ? ["YYYY/MM", "YYYY-MM"]
      : ["YYYY"];
  if (format !== undefined && !formats.includes(format))
    throw new TypeError(
      "format must match the value precision: " + formats.join(", "),
    );
  const input = await page.evaluate(dateState, { selector, read: "input" });
  if (!["text", "date", "month"].includes(input.type))
    throw new Error("Unsupported date input type");
  if (input.disabled) throw new Error("Date input is disabled");
  if (
    (input.type === "date" && !target.day) ||
    (input.type === "month" && (!target.month || target.day))
  )
    throw new Error("Date precision does not match the native input type");
  const expected = canonical(target);
  if (sameDate(input.value, target))
    return { value: input.value, date: expected, changed: false };
  if (mode === "input" || (mode === "auto" && !input.readOnly)) {
    if (input.readOnly)
      throw new Error("Date input is read only; use picker mode");
    const pattern = ["date", "month"].includes(input.type)
      ? formats.find((item) => !item.includes("/"))
      : (format ??
        formats.find((item) =>
          item.includes(input.value.includes("-") ? "-" : "/"),
        ) ??
        formats[0]);
    const rendered = pattern
      .replace("YYYY", String(target.year).padStart(4, "0"))
      .replace("MM", String(target.month).padStart(2, "0"))
      .replace("DD", String(target.day).padStart(2, "0"));
    await page.fill(selector, rendered);
    await page.press(selector, "Tab");
  } else {
    const existing = await page.evaluate(dateState, {
      selector,
      read: "panels",
    });
    if (existing.count)
      throw new Error("Close the open date picker before fillDate");
    await page.click(selector);
    let state = await picker(page, selector, timeout);
    if (!state.view)
      throw new Error(
        "Unsupported date picker; supported: Element UI / zhipin ui-date-picker",
      );
    const precision = target.day ? "day" : target.month ? "month" : "year";
    if (
      (precision === "day" && state.view !== "days") ||
      (precision === "month" && state.view !== "months") ||
      (precision === "year" && state.view !== "years")
    )
      throw new Error("Requested precision does not match the date picker");
    if (state.view === "years" || state.year !== target.year) {
      if (state.view !== "years") {
        await clickControl(page, state.yearLabel, "year header");
        state = await picker(page, selector, timeout, { view: "years" });
      }
      let moves = 0;
      while (!state.years.some((cell) => cell.value === target.year)) {
        if (++moves > 24)
          throw new Error(
            "Date year is more than 24 calendar pages away; stopping",
          );
        const oldFirst = state.years[0]?.value;
        if (oldFirst === undefined)
          throw new Error("Unsupported empty year grid");
        await clickControl(
          page,
          target.year < oldFirst ? state.previous : state.next,
          "year-page navigation",
        );
        state = await picker(page, selector, timeout, {
          view: "years",
          differentFirstYear: oldFirst,
        });
      }
      await clickControl(
        page,
        state.years.find((cell) => cell.value === target.year),
        "target year",
      );
      if (precision !== "year")
        state = await picker(page, selector, timeout, {
          view: "months",
          year: target.year,
        });
    }
    if (precision !== "year") {
      if (state.view === "days" && state.month !== target.month) {
        await clickControl(page, state.monthLabel, "month header");
        state = await picker(page, selector, timeout, {
          view: "months",
          year: target.year,
        });
      }
      if (state.view === "months") {
        await clickControl(
          page,
          state.months.find((cell) => cell.value === target.month),
          "target month",
        );
        if (precision === "day")
          state = await picker(page, selector, timeout, {
            view: "days",
            year: target.year,
            month: target.month,
          });
      }
      if (precision === "day")
        await clickControl(
          page,
          state.days.find((cell) => cell.value === target.day),
          "target day",
        );
    }
  }
  // Only a matching committed input value proves success. Hard stops propagate.
  await page.waitForFunction(
    ({ selector, expected }) => {
      const e = document.querySelector(selector);
      const value = e?.value?.trim().replaceAll("/", "-");
      const parts = value?.split("-");
      return (
        parts
          ?.map((part, i) => (i ? part.padStart(2, "0") : part))
          .join("-") === expected
      );
    },
    { selector, expected },
    { timeout },
  );
  const final = await page.evaluate(dateState, { selector, read: "input" });
  if (!sameDate(final.value, target))
    throw new Error(
      "Date value did not commit; inspect the Page before retrying",
    );
  return { value: final.value, date: expected, changed: true };
}

function parseDate(value) {
  if (
    typeof value !== "string" ||
    !/^\d{4}(?:[-/]\d{2}(?:[-/]\d{2})?)?$/.test(value)
  )
    throw new TypeError(
      "date must be YYYY, YYYY-MM, or YYYY-MM-DD (slashes also accepted)",
    );
  const [year, month, day] = value.split(/[-/]/).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (
    year < 1 ||
    year > 9999 ||
    (month !== undefined && (month < 1 || month > 12)) ||
    (day !== undefined &&
      (day < 1 ||
        day >
          [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
            month - 1
          ]))
  )
    throw new TypeError("Invalid calendar date");
  return { year, month, day };
}
const canonical = ({ year, month, day }) =>
  String(year).padStart(4, "0") +
  (month ? "-" + String(month).padStart(2, "0") : "") +
  (day ? "-" + String(day).padStart(2, "0") : "");
function sameDate(value, target) {
  const parts = value?.trim().split(/[-/]/);
  return (
    parts?.length === (target.day ? 3 : target.month ? 2 : 1) &&
    parts.every((part) => /^\d+$/.test(part)) &&
    parts.map(Number).join("-") ===
      [target.year, target.month, target.day]
        .filter((part) => part !== undefined)
        .join("-")
  );
}
async function clickControl(page, control, name) {
  if (!control || control.disabled || !control.selector)
    throw new Error(
      "Date picker cannot select " + name + " (missing/disabled); stopping",
    );
  await page.click(control.selector);
}
async function picker(page, selector, timeout, expected = {}) {
  await page.waitForFunction(dateReady, { selector, expected }, { timeout });
  return page.evaluate(dateState, { selector, read: "picker" });
}
// These DOM readers are self-contained because Page callbacks run in the browser.
function dateReady({ expected }) {
  const panels = [
    ...document.querySelectorAll(
      ".ui-picker-panel.ui-date-picker,.el-picker-panel.el-date-picker",
    ),
  ].filter((e) => {
    const style = getComputedStyle(e);
    return (
      e.getClientRects().length &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0.99 &&
      !/(?:enter|leave)-(?:active|from|to)/.test(e.className)
    );
  });
  if (panels.length !== 1) return false;
  const panel = panels[0];
  const table = (selector) =>
    [...panel.querySelectorAll(selector)].find(
      (e) =>
        e.getClientRects().length && getComputedStyle(e).display !== "none",
    );
  const view = table(".ui-year-table,.el-year-table")
    ? "years"
    : table(".ui-month-table,.el-month-table")
      ? "months"
      : table(".ui-date-table,.el-date-table")
        ? "days"
        : undefined;
  const labels = [
    ...panel.querySelectorAll(
      ".ui-date-picker-header-label,.el-date-picker__header-label",
    ),
  ]
    .filter((e) => e.getClientRects().length)
    .map((e) => e.textContent.trim());
  const year = Number(labels[0]?.match(/\d{4}/)?.[0]);
  const month = Number(labels[1]?.match(/\d{1,2}/)?.[0]);
  const first = Number(
    panel
      .querySelector(".ui-year-table td,.el-year-table td")
      ?.textContent.trim(),
  );
  return (
    (!expected.view || expected.view === view) &&
    (!expected.year || expected.year === year) &&
    (!expected.month || expected.month === month) &&
    (expected.differentFirstYear === undefined ||
      expected.differentFirstYear !== first)
  );
}
function dateState({ selector, read }) {
  const inputs = document.querySelectorAll(selector);
  if (inputs.length !== 1 || inputs[0].tagName !== "INPUT")
    throw new Error(
      "Date selector must identify exactly one input in the top document",
    );
  const input = inputs[0];
  if (read === "input")
    return {
      value: input.value,
      readOnly: input.readOnly,
      disabled: input.disabled,
      type: input.type,
    };
  const panels = [
    ...document.querySelectorAll(
      ".ui-picker-panel.ui-date-picker,.el-picker-panel.el-date-picker",
    ),
  ].filter((e) => {
    const style = getComputedStyle(e);
    return (
      e.getClientRects().length &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) > 0.99 &&
      !/(?:enter|leave)-(?:active|from|to)/.test(e.className)
    );
  });
  if (read === "panels") return { count: panels.length };
  if (panels.length !== 1)
    throw new Error("Date picker is ambiguous or no longer open");
  const panel = panels[0];
  const path = (e) => {
    const parts = [];
    while (e && e !== document.documentElement) {
      const parent = e.parentElement;
      if (!parent) throw new Error("Detached calendar control");
      parts.unshift(
        `${e.tagName.toLowerCase()}:nth-child(${[...parent.children].indexOf(e) + 1})`,
      );
      e = parent;
    }
    return "html > " + parts.join(" > ");
  };
  const control = (e, value) =>
    e
      ? {
          selector: path(e.querySelector("a,button,span") ?? e),
          value,
          disabled: Boolean(
            e.disabled ||
            e.getAttribute("aria-disabled") === "true" ||
            /(?:^|[\s_-])disabled(?:$|[\s_-])/.test(e.className),
          ),
        }
      : undefined;
  const labels = [
    ...panel.querySelectorAll(
      ".ui-date-picker-header-label,.el-date-picker__header-label",
    ),
  ].filter((e) => e.getClientRects().length);
  const table = (selector) =>
    [...panel.querySelectorAll(selector)].find(
      (e) =>
        e.getClientRects().length && getComputedStyle(e).display !== "none",
    );
  const yearTable = table(".ui-year-table,.el-year-table");
  const monthTable = table(".ui-month-table,.el-month-table");
  const dayTable = table(".ui-date-table,.el-date-table");
  const header = panel.querySelector(
    ".ui-date-picker-header,.el-date-picker__header",
  );
  const buttons = [...(header?.querySelectorAll("button") ?? [])].filter(
    (e) => e.getClientRects().length,
  );
  const chinese = [
    "一月",
    "二月",
    "三月",
    "四月",
    "五月",
    "六月",
    "七月",
    "八月",
    "九月",
    "十月",
    "十一月",
    "十二月",
  ];
  return {
    view: yearTable
      ? "years"
      : monthTable
        ? "months"
        : dayTable
          ? "days"
          : undefined,
    year: Number(labels[0]?.textContent.match(/\d{4}/)?.[0]),
    month: Number(labels[1]?.textContent.match(/\d{1,2}/)?.[0]),
    yearLabel: control(labels[0]),
    monthLabel: control(labels[1]),
    previous: control(buttons[0]),
    next: control(buttons.at(-1)),
    years: [...(yearTable?.querySelectorAll("td") ?? [])]
      .filter((e) => /^\d{4}$/.test(e.textContent.trim()))
      .map((e) => control(e, Number(e.textContent.trim()))),
    months: [...(monthTable?.querySelectorAll("td") ?? [])]
      .map((e) => {
        const text = e.textContent.trim().replace(/\s/g, "");
        const number =
          chinese.indexOf(text) + 1 || Number(text.match(/^(\d{1,2})月$/)?.[1]);
        return control(e, number);
      })
      .filter((e) => e.value >= 1 && e.value <= 12),
    days: [...(dayTable?.querySelectorAll("td") ?? [])]
      .filter(
        (e) =>
          !/(prev-month|next-month)/.test(e.className) &&
          /^\d{1,2}$/.test(e.textContent.trim()),
      )
      .map((e) => control(e, Number(e.textContent.trim()))),
  };
}
