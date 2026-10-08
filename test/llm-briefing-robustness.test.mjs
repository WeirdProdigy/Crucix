// Unit tests for LLM briefing robustness, Hungarian localization, schema enforcement,
// citation artifact cleaning, and 12 sweep scenario validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  localizedCountryName,
  stripCitationArtifacts,
  plainText,
  systemPrompt,
  userMessage,
  BRIEFING_JSON_SCHEMA,
  generateBriefing
} from '../lib/llm/briefing.mjs';

const VALID_EVENT_ID = `event-${'1'.repeat(32)}`;

// ─── a) Localization & Prompt Unit Tests ───

test('localizedCountryName resolves Hungarian country names via Intl.DisplayNames', () => {
  assert.equal(localizedCountryName('PHL', 'hu'), 'Fülöp-szigetek');
  assert.equal(localizedCountryName('LVA', 'hu'), 'Lettország');
  assert.equal(localizedCountryName('ZMB', 'hu'), 'Zambia');
  assert.equal(localizedCountryName('USA', 'hu'), 'Egyesült Államok');
  assert.equal(localizedCountryName('DEU', 'hu'), 'Németország');
  assert.equal(localizedCountryName('FRA', 'hu'), 'Franciaország');
  assert.equal(localizedCountryName('JPN', 'hu'), 'Japán');
});

test('localizedCountryName falls back to country.name for English or unknown codes', () => {
  assert.equal(localizedCountryName('FRA', 'en'), 'France');
  assert.equal(localizedCountryName('USA', 'en'), 'United States');
  assert.equal(localizedCountryName('XYZ', 'hu'), 'XYZ');
  assert.equal(localizedCountryName('NONEXISTENT', 'en'), 'NONEXISTENT');
});

test('systemPrompt includes Hungarian terminology and format rules when language=hu', () => {
  const huPrompt = systemPrompt('hu');
  assert.match(huPrompt, /Magyar terminológiai szabályok:/);
  assert.match(huPrompt, /szélerősség vagy szélsebesség \(SOHA ne fordítsd: szélenergia\)/);
  assert.match(huPrompt, /volcanic ash -> vulkáni hamu/);
  assert.match(huPrompt, /tropical -> trópusi/);
  assert.match(huPrompt, /detained -> őrizetbe vették/);
  assert.match(huPrompt, /torture -> kínzás/);
  assert.match(huPrompt, /storm surge -> vihardagály vagy viharhullám/);
  assert.match(huPrompt, /SOHA ne írj sorszámot vagy "refs" szót a "text" mezőbe!/);

  const enPrompt = systemPrompt('en');
  assert.doesNotMatch(enPrompt, /Magyar terminológiai szabályok:/);
});

test('userMessage injects localized country names into scope and row metadata', () => {
  const rows = [
    { level: 'high', kind: 'weather', title: 'Severe storm', countries: ['PHL', 'USA'], time: Date.now() }
  ];
  const countries = [{ iso3: 'LVA', score: 35 }];

  const huMsg = userMessage('LVA', rows, countries, 'hu');
  assert.match(huMsg.text, /SCOPE: Lettország \(LVA\)/);
  assert.match(huMsg.text, /Lettország \(LVA\): 35\/100/);
  assert.match(huMsg.text, /"countries":\["Fülöp-szigetek","Egyesült Államok"\]/);

  const enMsg = userMessage('LVA', rows, countries, 'en');
  assert.match(enMsg.text, /SCOPE: Latvia \(LVA\)/);
  assert.match(enMsg.text, /Latvia \(LVA\): 35\/100/);
  assert.match(enMsg.text, /"countries":\["Philippines","United States"\]/);
});

test('BRIEFING_JSON_SCHEMA specifies strict structured outputs schema', () => {
  assert.equal(BRIEFING_JSON_SCHEMA.name, 'briefing');
  assert.equal(BRIEFING_JSON_SCHEMA.strict, true);
  assert.equal(BRIEFING_JSON_SCHEMA.schema.type, 'object');
  assert.deepEqual(BRIEFING_JSON_SCHEMA.schema.required, ['bullets']);
  assert.deepEqual(BRIEFING_JSON_SCHEMA.schema.properties.bullets.items.required, ['text', 'refs']);
});

// ─── b) Deterministic Text Cleaning Unit Tests ───

test('stripCitationArtifacts strips parenthesized and bracketed refs while preserving non-citation numbers', () => {
  // Leaked citation brackets/parens
  assert.equal(stripCitationArtifacts('Kritikus vihar érkezik. (refs: 1)'), 'Kritikus vihar érkezik.');
  assert.equal(stripCitationArtifacts('Kritikus vihar érkezik. (refs: 1, 2)'), 'Kritikus vihar érkezik.');
  assert.equal(stripCitationArtifacts('Kritikus vihar érkezik. (Refs: 1, 2, 3)'), 'Kritikus vihar érkezik.');
  assert.equal(stripCitationArtifacts('Kritikus vihar érkezik. [refs: 1, 2]'), 'Kritikus vihar érkezik.');
  assert.equal(stripCitationArtifacts('Kritikus vihar érkezik. [1, 2]'), 'Kritikus vihar érkezik.');
  assert.equal(stripCitationArtifacts('Kritikus vihar érkezik. (1, 2)'), 'Kritikus vihar érkezik.');
  assert.equal(stripCitationArtifacts('Kritikus vihar érkezik. [1]'), 'Kritikus vihar érkezik.');
  assert.equal(stripCitationArtifacts('Esemény indult [1-3] a térségben.'), 'Esemény indult a térségben.');
  assert.equal(stripCitationArtifacts('Esemény (ref: 5) zajlik.'), 'Esemény zajlik.');

  // Standalone trailing refs
  assert.equal(
    stripCitationArtifacts('New Orleans (LA) területén figyelmeztetést adtak ki. Refs: 1, 2, 3, 4, 26, 27'),
    'New Orleans (LA) területén figyelmeztetést adtak ki.'
  );
  assert.equal(
    stripCitationArtifacts('Tallahassee (FL) viharriasztás érvényes. Refs: 6, 7, 8'),
    'Tallahassee (FL) viharriasztás érvényes.'
  );
  assert.equal(
    stripCitationArtifacts('Helyzetjelentés készült. Hivatkozások: 1, 2'),
    'Helyzetjelentés készült.'
  );

  // Legitimate parentheses and numbers MUST be preserved
  assert.equal(
    stripCitationArtifacts('New Orleans (LA) területén 213 km/h szélsebesség várható (10:01 CDT).'),
    'New Orleans (LA) területén 213 km/h szélsebesség várható (10:01 CDT).'
  );
  assert.equal(
    stripCitationArtifacts('M6.3-es földrengés történt Vanuatu térségében (10 km mélységben).'),
    'M6.3-es földrengés történt Vanuatu térségében (10 km mélységben).'
  );
});

test('plainText strips markdown, markup and citation artifacts in one pass', () => {
  const input = '**Kritikus** vihar <b>riasztás</b> [1] New Orleans (LA) térségében. Refs: 1, 2, 3';
  const cleaned = plainText(input);
  assert.equal(cleaned, 'Kritikus vihar riasztás New Orleans (LA) térségében.');
});

// ─── c) JSON Schema Enforcement in generateBriefing ───

test('generateBriefing supplies responseFormat json_schema to provider.complete', async () => {
  let capturedOpts = null;
  const mockProvider = {
    isConfigured: true,
    config: {},
    async complete(system, user, opts) {
      capturedOpts = opts;
      return {
        text: JSON.stringify({
          bullets: [{ text: 'Biztonsági összefoglaló', refs: [1] }]
        })
      };
    }
  };

  const now = Date.now();
  const rows = [{ id: VALID_EVENT_ID, title: 'Test event', level: 'high', kind: 'weather', observedAt: new Date(now).toISOString() }];
  const snapshot = { meta: { timestamp: new Date(now).toISOString() }, events: rows };

  const result = await generateBriefing({
    scope: 'global',
    snapshot,
    provider: mockProvider,
    language: 'hu',
    now
  });

  assert.equal(result.source, 'llm');
  assert.equal(capturedOpts.responseFormat.type, 'json_schema');
  assert.deepEqual(capturedOpts.responseFormat.json_schema, BRIEFING_JSON_SCHEMA);
  assert.equal(result.bullets[0].text, 'Biztonsági összefoglaló');
  assert.equal(result.bullets[0].refs[0].id, VALID_EVENT_ID);
});

// ─── d) 12 Sweep Scenarios: Before/After & Mistranslation Detector ───

test('12 sweep scenarios: before/after text cleaning and mistranslation auditing', () => {
  const BANNED_MISTRANSLATIONS = [
    /\bszélenergia\b/i,
    /\bvolánás por\b/i,
    /\bvolkanikus por\b/i,
    /\btropikai\b/i,
    /\belkobzott\b/i,
    /\bsztormelvidés\b/i,
  ];

  const LEAKED_CITATION_PATTERN = /\[\s*\d+\s*\]|\(\s*\d+\s*\)|\brefs?\s*:\s*\d+/i;

  function auditText(text) {
    const violations = [];
    for (const banned of BANNED_MISTRANSLATIONS) {
      if (banned.test(text)) violations.push(`Banned translation found: ${banned}`);
    }
    if (LEAKED_CITATION_PATTERN.test(text)) {
      violations.push(`Leaked citation artifact found in: "${text}"`);
    }
    return violations;
  }

  const scenarios = [
    {
      id: 1,
      title: 'SIMON-26 Tropical Cyclone',
      raw: 'Kritikus trópusi ciklon, a SIMON-26 aktív; 213 km/h maximális szélsebességgel és szél erősségű lökésekkel. Refs: 1, 6, 7',
      expectedClean: 'Kritikus trópusi ciklon, a SIMON-26 aktív; 213 km/h maximális szélsebességgel és szél erősségű lökésekkel.'
    },
    {
      id: 2,
      title: 'Taal Volcanic Ash Advisory',
      raw: 'Vulkáni kitörés és vulkáni hamu kibocsátás zajlik a Taal vulkánnál a Fülöp-szigeteken. (refs: 15)',
      expectedClean: 'Vulkáni kitörés és vulkáni hamu kibocsátás zajlik a Taal vulkánnál a Fülöp-szigeteken.'
    },
    {
      id: 3,
      title: 'Vanuatu M6.3 Earthquake',
      raw: '6.3-es magnitúdójú földrengés rázta meg Vanuatu térségét (10 km mélységben). [16, 17]',
      expectedClean: '6.3-es magnitúdójú földrengés rázta meg Vanuatu térségét (10 km mélységben).'
    },
    {
      id: 4,
      title: 'Harz Wind Warning Germany',
      raw: 'Vörös szintű szélfigyelmeztetés van érvényben Németországban a Harz-hegység térségében. (14)',
      expectedClean: 'Vörös szintű szélfigyelmeztetés van érvényben Németországban a Harz-hegység térségében.'
    },
    {
      id: 5,
      title: 'New Orleans Storm Surge Warning',
      raw: 'New Orleans (LA) területén kritikus vihardagály és hurrikán riasztást adtak ki (10:01 CDT). Refs: 1, 2, 3, 4, 26',
      expectedClean: 'New Orleans (LA) területén kritikus vihardagály és hurrikán riasztást adtak ki (10:01 CDT).'
    },
    {
      id: 6,
      title: 'Sudan Aid Workers Detained',
      raw: 'Szudánban több nemzetközi segélymunkást őrizetbe vettek a hatóságok az el-Fasher térségében. [refs: 5]',
      expectedClean: 'Szudánban több nemzetközi segélymunkást őrizetbe vettek a hatóságok az el-Fasher térségében.'
    },
    {
      id: 7,
      title: 'Belarus Political Prisoners Torture Allegation',
      raw: 'Független jogvédők kínzás és bántalmazás eseteit jelentették a minszki fogvatartási központokból. (refs: 8)',
      expectedClean: 'Független jogvédők kínzás és bántalmazás eseteit jelentették a minszki fogvatartási központokból.'
    },
    {
      id: 8,
      title: 'Greece Attica Wildfire Evacuation',
      raw: 'Görögországban gyorsan terjedő erdőtűz miatt lakossági kitelepítéseket rendeltek el Attika prefektúrában. [10, 11]',
      expectedClean: 'Görögországban gyorsan terjedő erdőtűz miatt lakossági kitelepítéseket rendeltek el Attika prefektúrában.'
    },
    {
      id: 9,
      title: 'Philippines Typhoon Flooding',
      raw: 'A Fülöp-szigetek északi részén kiterjedt áradások léptek fel a heves esőzések nyomán. (ref: 2)',
      expectedClean: 'A Fülöp-szigetek északi részén kiterjedt áradások léptek fel a heves esőzések nyomán.'
    },
    {
      id: 10,
      title: 'Black Sea Maritime Navigation Danger',
      raw: 'Tengeri aknaveszély miatt navigációs figyelmeztetést léptettek életbe a Fekete-tenger északnyugati medencéjében. Refs: 21, 22',
      expectedClean: 'Tengeri aknaveszély miatt navigációs figyelmeztetést léptettek életbe a Fekete-tenger északnyugati medencéjében.'
    },
    {
      id: 11,
      title: 'Latvia Critical Energy Infrastructure Outage',
      raw: 'Lettország északi körzetében üzemzavar lépett fel az átviteli villamosenergia-hálózatban. [4]',
      expectedClean: 'Lettország északi körzetében üzemzavar lépett fel az átviteli villamosenergia-hálózatban.'
    },
    {
      id: 12,
      title: 'Tyumen Aviation SIGMET Severe Icing',
      raw: 'Súlyos jégképződés miatti repülési SIGMET figyelmeztetés van érvényben Tyumen körzetében. (refs: 35, 36)',
      expectedClean: 'Súlyos jégképződés miatti repülési SIGMET figyelmeztetés van érvényben Tyumen körzetében.'
    }
  ];

  for (const scenario of scenarios) {
    const cleaned = plainText(scenario.raw);
    assert.equal(cleaned, scenario.expectedClean, `Scenario ${scenario.id} (${scenario.title}) mismatch`);
    const violations = auditText(cleaned);
    assert.deepEqual(violations, [], `Scenario ${scenario.id} has violations: ${violations.join('; ')}`);
  }
});
