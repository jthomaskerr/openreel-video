import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(process.cwd(), "../..");
const SOURCE_ROOTS = [
  "apps/web/src",
  "apps/orchestrator/src",
  "apps/image/src",
  "apps/resolve-bridge/resolve",
  "infra/transcribe-gpu",
  "packages",
];
const FORBIDDEN = [
  /from ["']uuid["']/,
  /\b(?:uuidv4|randomUUID)\b/,
  /\bUUID(?:_RE)?\b\s*(?:=|\.test\s*\()/,
  /\bz\.string\(\)\.uuid\(\)/,
  /\bcreateUnresolvedProject\s*\(/,
  /\bisClientOnlyProjectId\b/,
  /\b(?:temp|temporary|provisional)(?:Project|Media|Clip|Track|Effect|Job|Asset)?Id\b/i,
  /\b(?:id|[A-Za-z]+Id)\s*[:=].*(?:Date\.now\(\)|Math\.random\(\))/,
];

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    if (![".py", ".ts", ".tsx"].includes(extname(path))) return [];
    if (/\.(?:test|spec)\.[^.]+$/.test(path) || /\/test_[^/]+\.py$/.test(path)) return [];
    return [path];
  });
}

function violations(): string[] {
  return SOURCE_ROOTS.flatMap((sourceRoot) => productionFiles(resolve(REPO_ROOT, sourceRoot)))
    .flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return source.split("\n").flatMap((line, index) =>
        FORBIDDEN.some((pattern) => pattern.test(line))
          ? [`${relative(REPO_ROOT, path)}:${index + 1}: ${line.trim()}`]
          : [],
      );
    });
}

describe("domain identity architecture", () => {
  it("has no UUID or provisional domain identity generators", () => {
    expect(violations()).toEqual([]);
  });
});
