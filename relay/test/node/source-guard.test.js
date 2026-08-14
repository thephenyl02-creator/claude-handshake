// Static guards on the Worker source. These are assertions about the code
// itself, not its behaviour, so they run under `node --test` rather than in
// workerd — they need the filesystem, and they must hold for every file in
// src/ whether or not a test happens to execute it.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'src');

// The single permitted logging site (see PLAN section 3: never log bodies,
// redact Authorization).
const LOG_FILE = 'lib/log.js';

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((full) => ({
  path: relative(SRC, full).replace(/\\/g, '/'),
  text: readFileSync(full, 'utf8')
}));

describe('logging discipline', () => {
  it('has no console call site outside the redacted error path', () => {
    for (const file of FILES) {
      const hits = file.text.match(/console\s*\.\s*[a-z]+/g) || [];
      if (file.path === LOG_FILE) {
        assert.deepEqual(hits, ['console.error'], LOG_FILE + ' must hold exactly one console call');
      } else {
        assert.deepEqual(hits, [], 'console call site in ' + file.path);
      }
    }
  });

  it('never logs an error message, a request body or a header', () => {
    const log = FILES.find((f) => f.path === LOG_FILE).text;
    // err.message can quote the SQL row or JSON body that caused the throw.
    assert.ok(!/\.message/.test(log), 'log.js must not read .message');
    assert.ok(!/\bstack\b/.test(log), 'log.js must not read .stack');
    assert.ok(!/String\(\s*err/.test(log), 'log.js must not stringify the error itself');
    for (const file of FILES) {
      assert.ok(
        !/console[\s\S]{0,120}(authorization|bearer|body|token|secret)/i.test(file.text),
        'possible credential or body in a log call in ' + file.path
      );
    }
  });
});

describe('isolate safety', () => {
  it('has no module-scope mutable state', () => {
    for (const file of FILES) {
      const lines = file.text.split(/\r?\n/);
      lines.forEach((line, index) => {
        const where = file.path + ':' + (index + 1);
        // Column 0 == module scope in this codebase (everything nested is
        // indented). A module-scope binding that can be reassigned outlives
        // the request and is visible to the next eyeball on the isolate.
        assert.ok(!/^(let|var)\s/.test(line), 'module-scope mutable binding at ' + where);
        assert.ok(!/^globalThis\s*\./.test(line), 'global mutation at ' + where);
        assert.ok(
          !/^[A-Za-z_$][\w$]*\s*(=|\+\+|--|\+=)/.test(line),
          'module-scope assignment at ' + where
        );
      });
    }
  });

  it('freezes every module-scope collection it keeps', () => {
    for (const file of FILES) {
      const decl = /^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/gm;
      let match;
      while ((match = decl.exec(file.text)) !== null) {
        const [, name, value] = match;
        const isCollection = /^[[{]/.test(value) || /^new\s+(Map|Set|WeakMap|WeakSet)\(/.test(value);
        if (!isCollection) continue;
        // Object.freeze is the only form allowed: a Map or Set at module scope
        // cannot be made immutable at all, and is the classic accidental
        // cross-request cache.
        assert.fail('module-scope mutable collection ' + name + ' in ' + file.path + ' — wrap it in Object.freeze');
      }
    }
  });
});

describe('free-plan deploy contract', () => {
  const wrangler = readFileSync(join(ROOT, 'wrangler.toml'), 'utf8');

  it('declares every Durable Object class as SQLite-backed', () => {
    const migration = /new_sqlite_classes\s*=\s*\[([^\]]*)\]/.exec(wrangler);
    assert.ok(migration, 'wrangler.toml must declare new_sqlite_classes');
    const sqlite = migration[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
    const bound = [...wrangler.matchAll(/class_name\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(bound.length > 0, 'no durable object bindings found');
    for (const cls of bound) {
      assert.ok(sqlite.includes(cls), cls + ' is bound but not in new_sqlite_classes');
    }
  });

  it('never uses the paid-only key-value backend', () => {
    // `new_classes` is the KV-backed migration and is not available on the
    // free plan. This must stay a hard failure.
    assert.ok(!/^\s*new_classes\s*=/m.test(wrangler), 'wrangler.toml must not use new_classes');
  });

  it('keeps the create token out of committed config', () => {
    assert.ok(!/RELAY_CREATE_TOKEN\s*=/.test(wrangler.replace(/^#.*$/gm, '')), 'create token must be a secret');
  });
});
