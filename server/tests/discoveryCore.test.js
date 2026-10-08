// PHASE 10 — CSV PARSER, QUERY BUILDER, INTENT DETECTION, SERVICE MATCHING (pure functions, no database)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, suggestMapping, CsvError } from '../src/services/leads/import/csvParser.js';
import { buildQueries } from '../src/services/leads/discovery/queryBuilder.js';
import { detectIntent } from '../src/services/leads/discovery/intentDetector.js';
import { matchService } from '../src/services/leads/discovery/serviceMatcher.js';

describe('CSV parser', () => {
  it('reads quoted values with commas, quotes and line breaks inside', () => {
    const { headers, rows } = parseCsv('name,notes\r\n"Acme, Ltd","Said ""hi""\nand left"\r\nBeta,ok\r\n');
    assert.deepEqual(headers, ['name', 'notes']);
    assert.deepEqual(rows, [['Acme, Ltd', 'Said "hi"\nand left'], ['Beta', 'ok']]);
  });

  it('handles Excel BOM, semicolon files, blank lines and rows of only separators', () => {
    const { headers, rows, delimiter } = parseCsv('﻿Name;City\n\n;\nAcme;Lahore\n');
    assert.equal(delimiter, ';');
    assert.deepEqual(headers, ['Name', 'City']);
    assert.deepEqual(rows, [['Acme', 'Lahore']]);
  });

  it('short rows are padded, extra cells ignored', () => {
    const { rows } = parseCsv('a,b,c\n1\n1,2,3,4\n');
    assert.deepEqual(rows, [['1', '', ''], ['1', '2', '3']]);
  });

  it('rejects broken or abusive files', () => {
    assert.throws(() => parseCsv(''), CsvError);
    assert.throws(() => parseCsv('only,header\n'), CsvError);
    assert.throws(() => parseCsv('a,b\n"never closed,2\n'), CsvError);
    assert.throws(() => parseCsv('a,,b\n1,2,3\n'), /header/);
    assert.throws(() => parseCsv('a\n' + '1\n'.repeat(20), { maxBytes: 1e6, maxRows: 10, maxColumns: 5, maxCellLength: 100 }), /rows/);
    assert.throws(() => parseCsv(`a\n${'x'.repeat(200)}\n`, { maxBytes: 1e6, maxRows: 10, maxColumns: 5, maxCellLength: 100 }), /longer/);
    assert.throws(() => parseCsv('a\n\u0000\n'), /text/);
  });

  it('suggests column mapping from common header names', () => {
    const m = suggestMapping(['Company Name', 'E-mail', 'Mobile', 'Town', 'Website URL', 'Whatever']);
    assert.deepEqual(m, { 'Company Name': 'companyName', 'E-mail': 'email', Mobile: 'phone', Town: 'city', 'Website URL': 'website', Whatever: null });
  });
});

describe('Query builder (different queries per source, no duplicates)', () => {
  const settings = {
    discovery: { keywords: ['website developer'], intentPhrases: ['need a website', 'Need a website'], negativeKeywords: ['job', 'free course'], hashtags: ['needwebsite'] },
    icp: { cities: ['Islamabad'], countries: ['Pakistan'], industries: ['Real Estate'], businessTypes: ['Dentist'] },
  };

  it('web: quoted intent phrase + city, keyword + city + industry, single-word negatives', () => {
    const q = buildQueries(settings, 'GOOGLE_WEB');
    assert.deepEqual(q.map((x) => x.query), ['"need a website" "Islamabad" -job', '"website developer" "Islamabad" "Real Estate" -job']);
    assert.equal(q[0].matchedIntentPhrase, 'need a website');
    assert.equal(q[1].matchedKeyword, 'website developer');
  });

  it('local business: type + city + country', () => {
    assert.deepEqual(buildQueries(settings, 'LOCAL_BUSINESS').map((x) => x.query)[0], 'Dentist in Islamabad, Pakistan');
  });

  it('instagram: hashtags', () => {
    assert.deepEqual(buildQueries(settings, 'INSTAGRAM').map((x) => x.query), ['#needwebsite']);
  });

  it('respects the maximum and returns nothing for empty settings', () => {
    const many = { discovery: { keywords: Array.from({ length: 20 }, (_, i) => `kw ${i}`) }, icp: {} };
    assert.equal(buildQueries(many, 'GOOGLE_WEB', { max: 5 }).length, 5);
    assert.deepEqual(buildQueries({}, 'GOOGLE_WEB'), []);
  });
});

describe('Intent detection (only what is literally in the text)', () => {
  const cfg = { keywords: ['web developer'], intentPhrases: ['looking for', 'need a plot'], hashtags: ['needaplot'], negativeKeywords: ['job'] };

  it('buyer-intent phrase → HIGH', () => {
    const r = detectIntent('We are LOOKING FOR a good web developer in Lahore', cfg);
    assert.equal(r.intentLevel, 'HIGH');
    assert.equal(r.matchedIntentPhrase, 'looking for');
    assert.equal(r.matchedKeyword, 'web developer');
  });

  it('hashtag only → MEDIUM; negative keyword reported', () => {
    const r = detectIntent('New #NeedAPlot post — not a job ad', cfg);
    assert.equal(r.intentLevel, 'MEDIUM');
    assert.equal(r.matchedHashtag, 'needaplot');
    assert.equal(r.negativeKeyword, 'job');
  });

  it('whole words only: "jobs" ≠ "job", "plotting" ≠ "plot"', () => {
    const r = detectIntent('jobs board for plotting software', { negativeKeywords: ['job'], intentPhrases: ['plot'] });
    assert.equal(r.negativeKeyword, null);
    assert.equal(r.intentLevel, 'NONE');
  });

  it('works with Urdu text', () => {
    assert.equal(detectIntent('مجھے پلاٹ چاہیے اسلام آباد میں', { intentPhrases: ['پلاٹ چاہیے'] }).intentLevel, 'HIGH');
  });
});

describe('Service matching', () => {
  const services = [{ name: 'Website Development' }, { name: 'E-Commerce Store' }, { name: 'Residential Plots' }];
  it('matches by meaningful words', () => {
    assert.equal(matchService('Need a new website, development budget ready', services), 'Website Development');
    assert.equal(matchService('looking for plots in DHA', services), 'Residential Plots');
  });
  it('returns null when nothing really matches', () => {
    assert.equal(matchService('best biryani in town', services), null);
  });
});
