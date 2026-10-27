import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EN, LANGUAGES, format, isRef, join, localize, lookup, msg, pageCatalog, pick, systemLanguage, t } from '../src/i18n.js';
import { KO } from '../src/i18n-ko.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
// Text after a placeholder that only looks like a particle; removed before the particle check.
const PARTICLE_EXCEPTIONS = ['}가지'];

// The texts a catalog value holds: the string itself, or both branches of an English { one, other }.
function texts(key, value) {
  const list = typeof value === 'string' ? [value] : [value?.one, value?.other];
  assert.ok(list.every(text => typeof text === 'string'), `${key} must be a string or { one, other } of strings`);
  return list;
}

const shape = text => ({ names: [...new Set(Array.from(text.matchAll(/\{(\w+)\}/g), match => match[1]))].sort(), breaks: text.split('\n').length - 1 });

test('catalogs have the same keys, placeholders and line breaks', () => {
  assert.deepEqual(Object.keys(KO).sort(), Object.keys(EN).sort());
  for (const [key, value] of Object.entries(EN)) {
    for (const en of texts(key, value)) for (const ko of texts(key, KO[key])) assert.deepEqual(shape(ko), shape(en), key);
  }
});

test('every key literal in src exists in the English catalog', () => {
  const used = new Set();
  for (const file of readdirSync(SRC, { recursive: true }).filter(name => name.endsWith('.js'))) {
    const text = readFileSync(path.join(SRC, file), 'utf8');
    for (const pattern of [/['"`]((?:page|server|terminal|form|model|common)\.[\w.-]+)['"`]/g, /data-t(?:-\w+)?="([^"]+)"/g]) {
      for (const [, key] of text.matchAll(pattern)) used.add(key);
    }
  }
  assert.ok(used.has('common.language.en'), 'the scan reads the catalogs themselves');
  assert.deepEqual([...used].filter(key => !Object.hasOwn(EN, key)), []);
});

test('page keys are all in the page catalog', () => {
  const pageKeys = Object.keys(EN).filter(key => key.startsWith('page.')).sort();
  const { en, ko } = pageCatalog();
  assert.deepEqual(Object.keys(en).sort(), pageKeys);
  assert.deepEqual(Object.keys(ko).sort(), pageKeys);
});

test('Korean text puts no 받침-dependent particle right after a placeholder', () => {
  for (const [key, value] of Object.entries(KO)) {
    for (const text of texts(key, value)) {
      const checked = PARTICLE_EXCEPTIONS.reduce((rest, allowed) => rest.replaceAll(allowed, ''), text);
      assert.doesNotMatch(checked, /\}(?:이|가|을|를|은|는|과|와|으로|로|이나|나|이라|라)/u, key);
    }
  }
});

test('format and pick fill placeholders once and choose plurals by a raw count', () => {
  assert.equal(format('{a} and {b}', { a: '{b}', b: 'x' }), '{b} and x');
  assert.equal(format('{n} files', { n: 1234 }), '1234 files');
  assert.equal(format('{missing}', {}), '{missing}');
  assert.equal(format('{path}', { path: 'a/$&/b' }), 'a/$&/b');
  assert.equal(pick({ one: 'A', other: 'B' }, { count: 1 }), 'A');
  assert.equal(pick({ one: 'A', other: 'B' }, { count: 1234 }), 'B');
  assert.equal(pick('S', {}), 'S');
});

test('lookup falls back from Korean to English, and t falls back to the key without throwing', () => {
  assert.equal(lookup('ko', 'a', { en: { a: 'A' }, ko: { a: '가' } }), '가');
  assert.equal(lookup('ko', 'a', { en: { a: 'A' }, ko: {} }), 'A');
  assert.equal(lookup('ko', 'b', { en: {}, ko: {} }), undefined);
  assert.equal(t('ko', 'no.such.key'), 'no.such.key');
  assert.equal(t('en', 'toString'), 'toString');
  assert.equal(t('en', 'common.language.en'), 'English');
  assert.equal(t('ko', 'common.language.ko', null), '한국어');
});

test('msg and join build refs, and isRef accepts only their shapes', () => {
  assert.deepEqual(msg('k'), { $t: 'k' });
  assert.deepEqual(msg('k', { n: 1 }), { $t: 'k', $p: { n: 1 } });
  assert.deepEqual(join(['a', msg('k')], ' '), { $join: ['a', { $t: 'k' }], $sep: ' ' });
  assert.ok(isRef(msg('k')) && isRef(join([], ' ')));
  for (const value of [{ $t: 1 }, [{ path: 'a' }], { $join: 'a' }, 'k', null, undefined]) assert.equal(isRef(value), false);
});

test('localize resolves nested refs and joins and leaves strings alone', () => {
  const input = { message: msg('k', { lead: msg('k2') }), text: '{"$t":"server.x"} {x} [object Object]', evidence: { refs: [{ path: 'a' }] } };
  const before = structuredClone(input);
  const result = localize(input, 'en');
  assert.deepEqual(result, { message: 'k', text: input.text, evidence: input.evidence });
  assert.doesNotMatch(JSON.stringify(result), /"\$(?:t|join)"/);
  assert.notEqual(result.evidence.refs[0], input.evidence.refs[0]);
  assert.deepEqual(input, before);
  assert.equal(localize(join([msg('common.language.en'), join(['a', msg('common.language.ko')], '+')], ' · '), 'ko'), 'English · a+한국어');
  for (const value of ['plain', 7, null]) assert.equal(localize(value, 'ko'), value);
});

test('systemLanguage follows SPHINX_SYSTEM_LANGUAGE, then the locale', () => {
  assert.equal(systemLanguage({ env: {}, locale: 'ko-KR' }), 'ko');
  for (const locale of ['en-US', 'ja-JP', 'en-KR', 'x-invalid']) assert.equal(systemLanguage({ env: {}, locale }), 'en', locale);
  assert.equal(systemLanguage({ env: { SPHINX_SYSTEM_LANGUAGE: 'ko' }, locale: 'en-US' }), 'ko');
  assert.equal(systemLanguage({ env: { SPHINX_SYSTEM_LANGUAGE: 'en' }, locale: 'ko-KR' }), 'en');
  assert.equal(systemLanguage({ env: { SPHINX_SYSTEM_LANGUAGE: 'fr' }, locale: 'ko-KR' }), 'ko');
  assert.deepEqual(LANGUAGES, ['en', 'ko']);
  assert.ok(LANGUAGES.includes(systemLanguage()));
});
