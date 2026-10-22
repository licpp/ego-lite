import { egoErrorCode } from "./ego-errors.js";
import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type ResponseMatch = {
  urlIncludes?: string;
  urlExact?: string;
  method?: string;
  resourceType?: string;
  postDataIncludes?: string;
};

export type ResponseOptions = {
  timeout?: number;
  maxChars?: number;
  includeBody?: boolean;
  bodyFields?: string[];
  saveBodyAs?: string;
};

export type ObservedResponse = {
  requestId: string;
  method: string;
  url: string;
  resourceType?: string;
  state: "finished" | "failed";
  httpStatus?: number;
  httpOk?: boolean;
  mimeType?: string;
  fromCache?: boolean;
  fromServiceWorker?: boolean;
  redirects: Array<{ url: string; status: number }>;
  failure?: string;
  body: {
    kind: "json" | "text" | "binary" | "omitted" | "unavailable";
    json?: unknown;
    text?: string;
    truncated?: boolean;
    originalChars?: number;
    savedAs?: string;
    error?: string;
  };
};

type Services = {
  cdp(
    method: string,
    params: Record<string, unknown>,
    sessionId: string,
    timeoutMs?: number,
  ): Promise<any>;
  subscribePageEvents(
    targetId: string,
    listener: (event: any) => void,
    options?: { includeChildren?: boolean },
  ): () => void;
};

type Request = {
  sessionId: string;
  requestId: string;
  method: string;
  url: string;
  type?: string;
  postData?: string;
  response?: any;
  redirects: Array<{ url: string; status: number }>;
  slots: number[];
  terminal: boolean;
};

export class ResponseTimeoutError extends Error {
  readonly code = "EGO_RESPONSE_TIMEOUT";
  readonly partialResponses: Array<ObservedResponse | null>;
  constructor(partial: Array<ObservedResponse | undefined>) {
    super(
      "Timed out observing matching responses; the action may already have taken effect. Do not retry a write without checking its result.",
    );
    this.name = "ResponseTimeoutError";
    this.partialResponses = partial.map((value) => value ?? null);
  }
}

export function validateResponseMatch(
  value: unknown,
): asserts value is ResponseMatch {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("response match must be an object");
  const match = value as Record<string, unknown>;
  const keys = [
    "urlIncludes",
    "urlExact",
    "method",
    "resourceType",
    "postDataIncludes",
  ];
  if (Object.keys(match).some((key) => !keys.includes(key)))
    throw new TypeError("unknown response match field");
  for (const [key, item] of Object.entries(match)) {
    if (typeof item !== "string" || !item.trim())
      throw new TypeError(`response match ${key} must be a non-empty string`);
  }
  if (!match.urlIncludes && !match.urlExact)
    throw new TypeError("response match requires urlIncludes or urlExact");
}

export function validateResponseOptions(
  options: ResponseOptions,
  count: number,
): void {
  if (count < 1 || count > 16)
    throw new TypeError("provide 1–16 response matches");
  if (
    options.maxChars !== undefined &&
    (!Number.isInteger(options.maxChars) ||
      options.maxChars < 1 ||
      options.maxChars > 100_000)
  )
    throw new TypeError("maxChars must be an integer between 1 and 100000");
  if (
    options.timeout !== undefined &&
    (!Number.isFinite(options.timeout) || options.timeout <= 0)
  )
    throw new TypeError("timeout must be positive milliseconds");
  if (
    options.bodyFields !== undefined &&
    (!Array.isArray(options.bodyFields) ||
      options.bodyFields.length > 32 ||
      options.bodyFields.some(
        (path) => typeof path !== "string" || !path || path.length > 256,
      ))
  )
    throw new TypeError(
      "bodyFields must contain at most 32 non-empty dot paths (256 characters each)",
    );
  if (
    options.saveBodyAs !== undefined &&
    (typeof options.saveBodyAs !== "string" || !isAbsolute(options.saveBodyAs))
  )
    throw new TypeError("saveBodyAs must be an absolute file path");
  if (count > 1 && options.saveBodyAs)
    throw new TypeError("saveBodyAs is only supported for a single response");
  if (
    options.includeBody === false &&
    (options.saveBodyAs || options.bodyFields)
  )
    throw new TypeError(
      "includeBody:false cannot be combined with saveBodyAs or bodyFields",
    );
}

function matches(match: ResponseMatch, request: Request): boolean {
  return (
    (!match.urlIncludes || request.url.includes(match.urlIncludes)) &&
    (!match.urlExact || request.url === match.urlExact) &&
    (!match.method ||
      request.method.toUpperCase() === match.method.toUpperCase()) &&
    (!match.resourceType || request.type === match.resourceType) &&
    (!match.postDataIncludes ||
      request.postData?.includes(match.postDataIncludes) === true)
  );
}

function selectFields(
  json: unknown,
  fields: string[],
): Record<string, unknown> {
  const selected = Object.create(null);
  for (const path of fields) {
    let value = json;
    for (const key of path.split(".")) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) {
        value = undefined;
        break;
      }
      value = (value as any)[key];
    }
    if (value !== undefined) selected[path] = value;
  }
  return selected;
}

export async function readObservedBody(
  services: Services,
  request: Request,
  options: ResponseOptions,
  timeout: number,
  cancelled = () => false,
): Promise<ObservedResponse["body"]> {
  if (options.includeBody === false) return { kind: "omitted" };
  let raw: { body: string; base64Encoded?: boolean };
  try {
    raw = await services.cdp(
      "Network.getResponseBody",
      { requestId: request.requestId },
      request.sessionId,
      timeout,
    );
  } catch (error) {
    if (egoErrorCode(error)) throw error;
    return {
      kind: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (cancelled())
    return { kind: "unavailable", error: "Observation cancelled" };
  if (typeof raw?.body !== "string")
    return { kind: "unavailable", error: "CDP returned no response body" };
  const saved = options.saveBodyAs ? { savedAs: options.saveBodyAs } : {};
  if (options.saveBodyAs) {
    // Exclusive creation avoids silently overwriting a user's existing artifact.
    await writeFile(
      options.saveBodyAs,
      raw.base64Encoded ? Buffer.from(raw.body, "base64") : raw.body,
      { flag: "wx", mode: 0o600 },
    );
  }
  const textual =
    !raw.base64Encoded ||
    /json|text|xml|javascript|form-urlencoded/i.test(
      request.response?.mimeType || "",
    );
  if (!textual) return { kind: "binary", ...saved };
  const text = raw.base64Encoded
    ? Buffer.from(raw.body, "base64").toString("utf8")
    : raw.body;
  const maxChars = options.maxChars ?? 4000;
  // Avoid parsing unbounded JSON just to return a tiny excerpt.
  if (text.length <= 2_000_000) {
    try {
      const parsed = JSON.parse(text);
      const json = options.bodyFields
        ? selectFields(parsed, options.bodyFields)
        : parsed;
      const compact = JSON.stringify(json);
      if (compact.length <= maxChars)
        return {
          kind: "json",
          json,
          originalChars: text.length,
          truncated: false,
          ...saved,
        };
      return {
        kind: "json",
        text: compact.slice(0, maxChars),
        originalChars: text.length,
        truncated: true,
        ...saved,
      };
    } catch {
      /* Non-JSON responses remain bounded text. */
    }
  }
  return {
    kind: "text",
    text: text.slice(0, maxChars),
    originalChars: text.length,
    truncated: text.length > maxChars,
    ...saved,
  };
}

/** A passive, action-window collector. It never drains events or replays requests. */
export function prepareResponseObserver(
  services: Services,
  targetId: string,
  matchers: ResponseMatch[],
  options: ResponseOptions = {},
) {
  matchers.forEach(validateResponseMatch);
  validateResponseOptions(options, matchers.length);
  const timeoutMs = options.timeout ?? 10_000;
  const startedAt = Date.now();
  const requests = new Map<string, Request>();
  const claimed = new Set<number>();
  const results: Array<ObservedResponse | undefined> = Array(
    matchers.length,
  ).fill(undefined);
  let active = false,
    settled = false;
  let timer: ReturnType<typeof setTimeout>;
  let resolve!: (value: ObservedResponse[]) => void;
  let reject!: (reason: unknown) => void;
  const result = new Promise<ObservedResponse[]>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // The action can throw before callers await result; never leak an unhandled rejection.
  void result.catch(() => {});
  const cleanup = () => {
    clearTimeout(timer);
    unsubscribe();
    requests.clear();
  };
  const cancel = (
    reason: unknown = new Error("Response observation cancelled"),
  ) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(reason);
  };
  const onEvent = (event: any) => {
    if (!active || settled) return;
    const p = event?.params;
    if (typeof p?.requestId !== "string" || typeof event.sessionId !== "string")
      return;
    const key = `${event.sessionId}:${p.requestId}`;
    if (event.method === "Network.requestWillBeSent") {
      const prior = requests.get(key);
      const request: Request = {
        sessionId: event.sessionId,
        requestId: p.requestId,
        url: p.request?.url || "",
        method: p.request?.method || "",
        type: p.type,
        postData: p.request?.postData,
        redirects: prior?.redirects || [],
        slots: prior?.slots || [],
        terminal: false,
      };
      if (p.redirectResponse && prior)
        request.redirects.push({
          url: prior.url,
          status: p.redirectResponse.status,
        });
      matchers.forEach((match, index) => {
        if (!claimed.has(index) && matches(match, request)) {
          claimed.add(index);
          request.slots.push(index);
        }
      });
      // Ignore unrelated traffic entirely; only matched redirect chains need storage.
      if (request.slots.length) requests.set(key, request);
      return;
    }
    const request = requests.get(key);
    if (!request || request.terminal) return;
    if (event.method === "Network.responseReceived") {
      request.response = p.response;
      return;
    }
    if (
      event.method !== "Network.loadingFinished" &&
      event.method !== "Network.loadingFailed"
    )
      return;
    request.terminal = true;
    const failed = event.method === "Network.loadingFailed";
    const response: ObservedResponse = {
      requestId: request.requestId,
      method: request.method,
      url: request.url,
      resourceType: request.type,
      state: failed ? "failed" : "finished",
      redirects: request.redirects,
      ...(request.response
        ? {
            httpStatus: request.response.status,
            httpOk:
              request.response.status >= 200 && request.response.status < 300,
            mimeType: request.response.mimeType,
            fromCache: !!(
              request.response.fromDiskCache ||
              request.response.fromPrefetchCache
            ),
            fromServiceWorker: !!request.response.fromServiceWorker,
          }
        : {}),
      ...(failed ? { failure: p.errorText || "Network request failed" } : {}),
      body: { kind: failed ? "unavailable" : "omitted" },
    };
    void (async () => {
      try {
        if (!failed)
          response.body = await readObservedBody(
            services,
            request,
            options,
            Math.max(1, timeoutMs - (Date.now() - startedAt)),
            () => settled,
          );
        if (settled) return;
        for (const index of request.slots) results[index] = response;
        requests.delete(key);
        if (results.every(Boolean)) {
          settled = true;
          cleanup();
          resolve(results as ObservedResponse[]);
        }
      } catch (error) {
        cancel(error);
      }
    })();
  };
  const unsubscribe = services.subscribePageEvents(targetId, onEvent, {
    includeChildren: true,
  });
  timer = setTimeout(
    () => cancel(new ResponseTimeoutError(results)),
    timeoutMs,
  );
  return {
    result,
    start() {
      if (!settled) active = true;
    },
    cancel,
  };
}
