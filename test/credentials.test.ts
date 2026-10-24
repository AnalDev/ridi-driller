import { describe, expect, it } from "vitest";
import { parseRidiCredentials } from "@/lib/ridi/credentials";

const ACCESS_TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";

describe("RIDI credential parser", () => {
  it("accepts a raw ridi-at JWT", () => {
    expect(parseRidiCredentials(ACCESS_TOKEN)).toEqual({ ridiAt: ACCESS_TOKEN });
  });

  it("extracts only short-lived request credentials from cookie JSON", () => {
    const input = JSON.stringify([
      { name: "ridi-at", value: ACCESS_TOKEN },
      { name: "ridi-rt", value: "long-lived-refresh-token" },
      { name: "cf_clearance", value: "clearance.value_1" },
    ]);
    expect(parseRidiCredentials(input)).toEqual({
      ridiAt: ACCESS_TOKEN,
      cfClearance: "clearance.value_1",
      userAgent: undefined,
    });
  });

  it("parses a Cookie header", () => {
    expect(parseRidiCredentials(`Cookie: other=1; ridi-at=${ACCESS_TOKEN}; cf_clearance=clearance-2`)).toEqual({
      ridiAt: ACCESS_TOKEN,
      cfClearance: "clearance-2",
      userAgent: undefined,
    });
  });

  it("parses browser Copy as cURL input with its matching User-Agent", () => {
    const input = `curl --url 'https://ridibooks.com/cart' \\
      -b 'other=1; ridi-at=${ACCESS_TOKEN}; ridi-rt=ignored; cf_clearance=clearance_3' \\
      -H 'accept: text/html' \\
      -H 'user-agent: Mozilla/5.0 Test Browser/1.0'`;
    expect(parseRidiCredentials(input)).toEqual({
      ridiAt: ACCESS_TOKEN,
      cfClearance: "clearance_3",
      userAgent: "Mozilla/5.0 Test Browser/1.0",
    });
  });

  it("rejects malformed tokens and unsafe User-Agent values", () => {
    expect(parseRidiCredentials("not-a-jwt")).toBeNull();
    const input = `curl -b 'ridi-at=${ACCESS_TOKEN}' -H 'user-agent: ok\nInjected: true'`;
    expect(parseRidiCredentials(input)).toEqual({
      ridiAt: ACCESS_TOKEN,
      cfClearance: undefined,
      userAgent: undefined,
    });
  });
});
