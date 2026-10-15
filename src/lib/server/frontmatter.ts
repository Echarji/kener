import yaml from "js-yaml";

export interface FrontMatterResult<T> {
  attributes: T;
  body: string;
}

/**
 * Matches a YAML front-matter block that starts at the beginning of a line:
 * an opening `---` (or `= yaml =`) delimiter, the YAML body, then a closing
 * `---` (or `...`) delimiter. Supports an optional BOM and CRLF line endings.
 *
 * Group 1 is the opening delimiter (used as the back-reference for the closing
 * delimiter), group 2 is the raw YAML body.
 */
const FRONT_MATTER_PATTERN = /^(?:\ufeff)?(= yaml =|---)$([\s\S]*?)^(?:\1|\.\.\.)\s*$(?:\n)?/m;

/**
 * Parse a Markdown string's YAML front matter.
 *
 * This is a drop-in replacement for the `front-matter` package, which depends on
 * `js-yaml@3` → `argparse` → `sprintf-js` — a chain with an unfixed ReDoS advisory.
 * Parsing with js-yaml v4 (already a direct dependency) avoids that chain entirely
 * while keeping identical behaviour for our docs content.
 */
export function parseFrontMatter<T = Record<string, unknown>>(input: string | null | undefined): FrontMatterResult<T> {
  const source = input || "";
  const match = FRONT_MATTER_PATTERN.exec(source);

  if (!match) {
    return { attributes: {} as T, body: source };
  }

  const yamlSource = (match[2] || "").replace(/^\s+|\s+$/g, "");
  const attributes = (yaml.load(yamlSource) as T) || ({} as T);
  const body = source.replace(match[0], "");

  return { attributes, body };
}
