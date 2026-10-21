import test from "node:test";
import assert from "node:assert/strict";
import {
  fillFields,
  saveAndVerify,
} from "../../../skills/ego-browser/scripts/form-helpers.mjs";

test("shared form helpers reuse selectors and verify a fresh saved result", async () => {
  const calls = [];
  const verify = (id) => id === "new-id";
  const page = {
    async fill(...args) {
      calls.push(["fill", ...args]);
    },
    async evaluate(fn, arg) {
      assert.equal(fn, verify);
      assert.equal(arg, "new-id");
      return false;
    },
    async click(selector) {
      calls.push(["click", selector]);
    },
    async waitForFunction(fn, arg, options) {
      assert.equal(fn, verify);
      assert.equal(arg, "new-id");
      assert.deepEqual(options, { timeout: 1234 });
      calls.push(["verified"]);
    },
  };
  assert.deepEqual(
    await fillFields(page, [{ selector: "#name", value: "Example" }]),
    { filled: 1 },
  );
  assert.deepEqual(
    await saveAndVerify(page, {
      save: "#save",
      verify,
      arg: "new-id",
      timeout: 1234,
    }),
    { saved: true },
  );
  assert.deepEqual(calls, [
    ["fill", "#name", "Example"],
    ["click", "#save"],
    ["verified"],
  ]);
});

test("stale confirmations block saves and a hard stop prevents subsequent fields", async () => {
  let clicks = 0;
  await assert.rejects(
    () =>
      saveAndVerify(
        {
          async evaluate() {
            return true;
          },
          async click() {
            clicks++;
          },
        },
        { save: "#save", verify: () => true },
      ),
    /already matches/,
  );
  assert.equal(clicks, 0);
  const stop = new Error("user control hard stop");
  let fills = 0;
  await assert.rejects(
    () =>
      fillFields(
        {
          async fill() {
            fills++;
            throw stop;
          },
        },
        [
          { selector: "#first", value: "1" },
          { selector: "#second", value: "2" },
        ],
      ),
    (error) => error === stop,
  );
  assert.equal(fills, 1);
  await assert.rejects(
    () =>
      fillFields(
        {
          async fill() {
            fills++;
          },
        },
        [
          { selector: "#first", value: "1" },
          { selector: "#second", value: null },
        ],
      ),
    TypeError,
  );
  assert.equal(
    fills,
    1,
    "validate the whole fill plan before mutating the form",
  );
});
