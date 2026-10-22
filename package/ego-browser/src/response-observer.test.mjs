import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareResponseObserver,
  validateResponseMatch,
  validateResponseOptions,
} from "../dist/src/response-observer.js";

function fixture(options = {}) {
  const listeners = new Set(),
    calls = [];
  const services = {
    subscribePageEvents(target, fn, opts) {
      assert.equal(target, "page");
      assert.equal(opts.includeChildren, true);
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async cdp(method, params, sessionId) {
      calls.push({ method, params, sessionId });
      if (options.error) throw options.error;
      if (options.read) return options.read(params.requestId);
      return {
        body: JSON.stringify({
          code: 400,
          message: "invalid title",
          data: { id: 7 },
          unused: "x".repeat(300),
        }),
      };
    },
  };
  function emit(method, params, sessionId = "main") {
    for (const fn of [...listeners]) fn({ method, params, sessionId });
  }
  function request(
    id,
    url = "https://example.test/save",
    method = "POST",
    session = "main",
    extra = {},
  ) {
    emit(
      "Network.requestWillBeSent",
      { requestId: id, type: "Fetch", request: { url, method, ...extra } },
      session,
    );
  }
  function response(id, { session = "main", status = 200, ...extra } = {}) {
    emit(
      "Network.responseReceived",
      {
        requestId: id,
        response: { status, mimeType: "application/json", ...extra },
      },
      session,
    );
    emit("Network.loadingFinished", { requestId: id }, session);
  }
  return { services, emit, request, response, calls, listeners };
}
const match = { urlIncludes: "/save", method: "POST" };

test("passive action-window ignores older traffic, waits for body, and preserves business failure", async () => {
  const f = fixture(),
    observer = prepareResponseObserver(f.services, "page", [match], {
      bodyFields: ["code", "message", "data.id"],
    });
  f.request("old");
  observer.start();
  f.response("old");
  f.request("poll", "https://example.test/save", "GET");
  f.response("poll");
  f.request("actual");
  f.response("actual");
  const [r] = await observer.result;
  assert.equal(r.requestId, "actual");
  assert.equal(r.httpOk, true);
  assert.deepEqual(
    { ...r.body.json },
    { code: 400, message: "invalid title", "data.id": 7 },
  );
  assert.equal("success" in r, false);
  assert.equal(f.listeners.size, 0);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["Network.getResponseBody"],
  );
});

test("multi-response ordering and session-qualified ids isolate upload and save", async () => {
  const f = fixture(),
    o = prepareResponseObserver(
      f.services,
      "page",
      [{ urlIncludes: "/upload" }, match],
      {},
    );
  o.start();
  f.request("same", "https://example.test/upload", "POST", "child");
  f.request("same");
  f.response("same");
  f.response("same", { session: "child" });
  const rows = await o.result;
  assert.equal(rows[0].url, "https://example.test/upload");
  assert.equal(rows[1].url, "https://example.test/save");
  assert.deepEqual(f.calls.map((c) => c.sessionId).sort(), ["child", "main"]);
});

test("request body discriminator does not return request payloads", async () => {
  const f = fixture(),
    o = prepareResponseObserver(
      f.services,
      "page",
      [{ ...match, postDataIncludes: "id=2" }],
      {},
    );
  o.start();
  f.request("wrong", undefined, "POST", "main", { postData: "id=1" });
  f.response("wrong");
  f.request("right", undefined, "POST", "main", {
    postData: "id=2&secret=private",
  });
  f.response("right");
  const [r] = await o.result;
  assert.equal(r.requestId, "right");
  assert(!JSON.stringify(r).includes("private"));
});

test("redirects follow the same request and do not mistake redirect for final success", async () => {
  const f = fixture(),
    o = prepareResponseObserver(f.services, "page", [match], {});
  o.start();
  f.request("a");
  f.emit("Network.requestWillBeSent", {
    requestId: "a",
    request: { method: "GET", url: "https://example.test/done" },
    redirectResponse: { status: 302 },
  });
  f.response("a", { status: 403 });
  const [r] = await o.result;
  assert.equal(r.httpOk, false);
  assert.equal(r.httpStatus, 403);
  assert.deepEqual(r.redirects, [
    { url: "https://example.test/save", status: 302 },
  ]);
});

test("loadingFailed returns explicit evidence without trying to read a body", async () => {
  const f = fixture(),
    o = prepareResponseObserver(f.services, "page", [match], {});
  o.start();
  f.request("a");
  f.emit("Network.loadingFailed", {
    requestId: "a",
    errorText: "net::ERR_FAILED",
  });
  const [r] = await o.result;
  assert.equal(r.state, "failed");
  assert.equal(r.failure, "net::ERR_FAILED");
  assert.equal(f.calls.length, 0);
});

test("timeout reports ordered partial evidence, detaches listeners, and warns against retry", async () => {
  const f = fixture(),
    o = prepareResponseObserver(
      f.services,
      "page",
      [match, { urlIncludes: "/missing" }],
      { timeout: 30, includeBody: false },
    );
  o.start();
  f.request("a");
  f.response("a");
  await assert.rejects(
    o.result,
    (e) =>
      e.code === "EGO_RESPONSE_TIMEOUT" &&
      e.partialResponses[0].requestId === "a" &&
      e.partialResponses[1] === null &&
      /already/.test(e.message),
  );
  assert.equal(f.listeners.size, 0);
});

test("bounded body omits duplicates, metadata mode avoids reading, missing fields are not fabricated", async () => {
  for (const options of [
    { maxChars: 10 },
    { bodyFields: ["does.not.exist"] },
    { includeBody: false },
  ]) {
    const f = fixture(),
      o = prepareResponseObserver(f.services, "page", [match], options);
    o.start();
    f.request("a");
    f.response("a");
    const [r] = await o.result;
    if (options.maxChars) {
      assert.equal(r.body.text.length, 10);
      assert.equal(r.body.truncated, true);
      assert.equal(r.body.json, undefined);
    }
    if (options.bodyFields) assert.deepEqual({ ...r.body.json }, {});
    if (options.includeBody === false) {
      assert.equal(r.body.kind, "omitted");
      assert.equal(f.calls.length, 0);
    }
  }
});

test("body eviction is unavailable, native control errors propagate", async () => {
  for (const error of [
    new Error("No resource with given identifier"),
    Object.assign(new Error("user took control"), {
      error_code: "EGO_TASK_SPACE_USER_IN_CONTROL",
    }),
    Object.assign(new Error("task ended"), {
      error_code: "EGO_TASK_SPACE_INACTIVE",
    }),
  ]) {
    const f = fixture({ error }),
      o = prepareResponseObserver(f.services, "page", [match], {});
    o.start();
    f.request("a");
    f.response("a");
    if (error.error_code) await assert.rejects(o.result, (e) => e === error);
    else {
      const [r] = await o.result;
      assert.equal(r.body.kind, "unavailable");
    }
    assert.equal(f.listeners.size, 0);
  }
});

test("binary is not dumped to context, full JSON can be saved without overwriting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ego-response-"));
  try {
    const path = join(dir, "body.json");
    const f = fixture(),
      o = prepareResponseObserver(f.services, "page", [match], {
        saveBodyAs: path,
        maxChars: 5,
      });
    o.start();
    f.request("a");
    f.response("a");
    const [r] = await o.result;
    assert.equal(r.body.savedAs, path);
    assert.equal(JSON.parse(await readFile(path, "utf8")).code, 400);
    const f2 = fixture(),
      o2 = prepareResponseObserver(f2.services, "page", [match], {
        saveBodyAs: path,
      });
    o2.start();
    f2.request("a");
    f2.response("a");
    await assert.rejects(o2.result, { code: "EEXIST" });
    const f3 = fixture({
        read: async () => ({ body: "AAEC", base64Encoded: true }),
      }),
      o3 = prepareResponseObserver(f3.services, "page", [match], {});
    o3.start();
    f3.request("b");
    f3.response("b", { mimeType: "image/png" });
    assert.equal((await o3.result)[0].body.kind, "binary");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cancel during body read never writes a late artifact", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ego-response-cancel-"));
  try {
    let finish;
    const f = fixture({ read: () => new Promise((r) => (finish = r)) }),
      o = prepareResponseObserver(f.services, "page", [match], {
        saveBodyAs: join(dir, "late.json"),
      });
    o.start();
    f.request("a");
    f.response("a");
    o.cancel(new Error("action failed"));
    finish({ body: "{}" });
    await assert.rejects(o.result, /action failed/);
    await new Promise((r) => setTimeout(r, 5));
    await assert.rejects(readFile(join(dir, "late.json")), { code: "ENOENT" });
    assert.equal(f.listeners.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("match/options reject ambiguous or dangerous configuration before action", () => {
  for (const invalid of [
    {},
    { urlIncludes: "" },
    { urlIncludes: "/save", bogus: 1 },
    null,
  ])
    assert.throws(() => validateResponseMatch(invalid), TypeError);
  for (const invalid of [
    { maxChars: 100001 },
    { maxChars: 0 },
    { bodyFields: [""] },
    { saveBodyAs: "relative" },
    { includeBody: false, bodyFields: ["code"] },
  ])
    assert.throws(() => validateResponseOptions(invalid, 1), TypeError);
  assert.throws(
    () => validateResponseOptions({ saveBodyAs: "/tmp/file" }, 2),
    TypeError,
  );
});
