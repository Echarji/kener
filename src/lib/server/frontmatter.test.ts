import { describe, it, expect } from "vitest";
import { parseFrontMatter } from "./frontmatter";

describe("parseFrontMatter", () => {
  it("parses a standard --- block and strips it from the body", () => {
    const raw = "---\ntitle: Hello\ndescription: World\n---\n# Heading\n";
    const result = parseFrontMatter<{ title: string; description: string }>(raw);
    expect(result.attributes).toEqual({ title: "Hello", description: "World" });
    expect(result.body).toBe("# Heading\n");
  });

  it("returns the input unchanged when there is no front matter", () => {
    const raw = "# Heading\n\nBody text\n";
    const result = parseFrontMatter(raw);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe(raw);
  });

  it("supports the `= yaml =` opening delimiter and `...` terminator", () => {
    const raw = "= yaml =\ntitle: Alt\n...\nBody\n";
    const result = parseFrontMatter<{ title: string }>(raw);
    expect(result.attributes).toEqual({ title: "Alt" });
    expect(result.body).toBe("Body\n");
  });

  it("strips a leading byte order mark", () => {
    const raw = "\ufeff---\ntitle: Bom\n---\nBody\n";
    const result = parseFrontMatter<{ title: string }>(raw);
    expect(result.attributes).toEqual({ title: "Bom" });
    expect(result.body).toBe("Body\n");
  });

  it("handles CRLF line endings", () => {
    const raw = "---\r\ntitle: Crlf\r\n---\r\nBody\r\n";
    const result = parseFrontMatter<{ title: string }>(raw);
    expect(result.attributes).toEqual({ title: "Crlf" });
    expect(result.body).toBe("Body\r\n");
  });

  it("treats an empty front-matter block as empty attributes", () => {
    const raw = "---\n---\nBody\n";
    const result = parseFrontMatter(raw);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe("Body\n");
  });

  it("handles null and undefined input", () => {
    expect(parseFrontMatter(null)).toEqual({ attributes: {}, body: "" });
    expect(parseFrontMatter(undefined)).toEqual({ attributes: {}, body: "" });
  });

  it("does not add a bodyBegin field that callers might accidentally rely on", () => {
    // The old `front-matter` package returned a `bodyBegin` field that nothing
    // in Kener consumes; make sure we do not reintroduce or depend on it.
    const result = parseFrontMatter("---\ntitle: X\n---\n");
    expect(result).not.toHaveProperty("bodyBegin");
  });
});
