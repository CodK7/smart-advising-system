import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SKIPPED_DIRECTORIES = new Set([
  '.agents',
  '.claude',
  '.git',
  '.impeccable',
  'coverage',
  'dist',
  'docs',
  'node_modules',
]);

const TEXT_EXTENSIONS = new Set([
  '.bat',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sql',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const TEXT_FILE_NAMES = new Set(['.editorconfig', '.env.example', '.gitignore']);

function projectTextFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return projectTextFiles(filePath);
    return TEXT_FILE_NAMES.has(entry.name) || TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ? [filePath]
      : [];
  });
}

describe('source-file encoding', () => {
  it('keeps project text as valid UTF-8 without common mojibake markers', () => {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const invalidUtf8: string[] = [];
    const mojibake: string[] = [];

    for (const filePath of projectTextFiles(process.cwd())) {
      const relativePath = path.relative(process.cwd(), filePath);
      let source: string;
      try {
        source = decoder.decode(readFileSync(filePath));
      } catch {
        invalidUtf8.push(relativePath);
        continue;
      }

      // These code points are the characteristic first characters produced
      // when UTF-8 Arabic, emoji, punctuation, or accented text is decoded as
      // a legacy single-byte encoding and then saved again.
      if (/[\u00c2\u00c3\u00d8\u00d9\u00e2\u00ef\ufffd]/u.test(source)) {
        mojibake.push(relativePath);
      }
    }

    expect(invalidUtf8, `Invalid UTF-8 files:\n${invalidUtf8.join('\n')}`).toEqual([]);
    expect(mojibake, `Possible mojibake files:\n${mojibake.join('\n')}`).toEqual([]);
  });
});
