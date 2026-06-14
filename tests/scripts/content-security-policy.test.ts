import { describe, expect, it } from "vitest";
import { CONTENT_SECURITY_POLICY } from "../../scripts/content-security-policy";

// Parse the policy string into a directive -> sources map for precise assertions.
const directives = new Map(
  CONTENT_SECURITY_POLICY.split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const [name, ...sources] = part.split(/\s+/);
      return [name, sources] as const;
    })
);

describe("CONTENT_SECURITY_POLICY", () => {
  it("locks scripts to the app's own bundles — never inline or eval", () => {
    // The load-bearing security property: the packaged renderer can only run its own scripts, so an
    // injected <script> or eval() can't execute even if some future XSS slips past React's escaping.
    expect(directives.get("script-src")).toEqual(["'self'"]);
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe-eval");
    expect(directives.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("allows the data: image URLs the thumbnails/previews/histogram render", () => {
    expect(directives.get("img-src")).toEqual(["'self'", "data:"]);
  });

  it("allows inline styles (React style props + Vite-injected CSS) but nothing remote", () => {
    expect(directives.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("sets a restrictive default and blocks plugins and base-tag injection", () => {
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'self'"]);
  });

  it("does not open any source to the whole web", () => {
    expect(CONTENT_SECURITY_POLICY).not.toContain("*");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/\bhttps?:/); // no remote http(s) sources at all
  });
});
