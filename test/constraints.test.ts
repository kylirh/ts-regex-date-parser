import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Enforces the project's ground rules: the library is written from scratch,
// with no native date APIs and no third-party imports.

const SRC_DIR = join(import.meta.dirname, '..', 'src');
const sources = readdirSync(SRC_DIR)
  .filter((file) => file.endsWith('.ts'))
  .map((file) => ({ file, code: stripComments(readFileSync(join(SRC_DIR, file), 'utf8')) }));

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('project constraints', () => {
  it('finds the source files', () => {
    assert.ok(sources.length >= 3);
  });

  for (const { file, code } of sources) {
    it(`${file} never references Date, Intl or Temporal`, () => {
      const forbidden = /(?<![\w$])(?:Date|Intl|Temporal)(?![\w$])|toLocale\w*String/g;
      assert.deepEqual(code.match(forbidden), null);
    });

    it(`${file} only imports relative modules`, () => {
      const specifiers = [...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)]
        .map((match) => match[1] ?? match[2]);
      for (const specifier of specifiers) {
        assert.match(specifier!, /^\.\.?\//, `${file} imports ${specifier}`);
      }
      assert.doesNotMatch(code, /\brequire\s*\(/);
    });
  }

  it('package.json declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.peerDependencies, undefined);
  });
});
