/** Small task-module building blocks. Pass a managed Page; no native bypasses. */
export async function fillFields(page, fields) {
  if (
    !Array.isArray(fields) ||
    fields.some(
      (field) =>
        !field ||
        typeof field.selector !== "string" ||
        !field.selector.trim() ||
        typeof field.value !== "string",
    )
  ) {
    throw new TypeError(
      "fields must be an array of { selector, value } strings",
    );
  }
  for (const { selector, value } of fields) await page.fill(selector, value);
  return { filled: fields.length };
}

/** Verify a new result, rather than trusting a click or an existing success toast. */
export async function saveAndVerify(
  page,
  { save, verify, arg, timeout = 10000 },
) {
  if (
    typeof save !== "string" ||
    !save.trim() ||
    typeof verify !== "function" ||
    !Number.isFinite(timeout) ||
    timeout <= 0
  ) {
    throw new TypeError("save, verify and a positive timeout are required");
  }
  if (await page.evaluate(verify, arg)) {
    throw new Error(
      "Save confirmation already matches before clicking. Verify a new record or changed value instead.",
    );
  }
  await page.click(save);
  await page.waitForFunction(verify, arg, { timeout });
  return { saved: true };
}

export { fillDate } from "./date-helpers.mjs";
