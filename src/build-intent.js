'use strict';

const PROFILES = {
  game: { option: 'build', label: 'Build new', instructions: 'Build a browser game using AtomOS scenes, state, events, sprites, tile maps, physics, camera, audio and game UI. Do not add authentication, accounts, tokens, databases, APIs or a backend unless the user explicitly asks for them.' },
  website: { option: 'build', label: 'Build new', instructions: 'Build a browser website using screens, navigation, responsive groups, repeat lists, forms and declarative state. Do not add a backend, authentication or database unless explicitly requested.' },
  fullstack: { option: 'fullstack', label: 'Build full stack', instructions: 'Build a frontend and backend together. Include only services, persistence and authentication explicitly required by the request.' },
  code: { option: 'code', label: 'Build code app', instructions: 'Build a standalone code application or developer tool in the requested language. Do not reinterpret it as a website or service.' },
  app: { option: 'build', label: 'Build new', instructions: 'Build a small interactive AtomOS application with declarative state, components and events.' }
};

const TERMS = {
  game: [['game',4],['platformer',7],['platform game',8],['rpg',6],['shooter',6],['puzzle game',6],['sprite',4],['tile map',5],['tilemap',5],['collision',4],['gravity',4],['jump',3],['enemy',2],['enemies',2],['coins',2],['lives',2],['checkpoint',3],['camera follow',4],['boss',2],['canvas game',6],['html5 canvas',5]],
  website: [['website',6],['landing page',6],['portfolio',5],['blog',4],['responsive page',4],['navigation',2],['gallery',2],['web page',5],['marketing site',6]],
  fullstack: [['full stack',8],['fullstack',8],['backend',5],['database',4],['api',3],['rest api',5],['authentication',5],['login',3],['signup',3],['user accounts',4],['server',3],['postgres',5],['sqlite',4],['payments',4],['admin dashboard',3]],
  code: [['python tool',7],['python script',7],['command line',5],['cli',5],['desktop app',5],['tkinter',7],['script',3],['compiler',4]]
};

function has(text, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function classifyBuildIntent(prompt) {
  const text = String(prompt || '').trim().toLowerCase();
  const scores = { game: 0, website: 0, fullstack: 0, code: 0, app: 1 };
  const evidence = [];
  for (const [kind, terms] of Object.entries(TERMS)) for (const [term, weight] of terms) {
    if (has(text, term)) { scores[kind] += weight; evidence.push({ kind, term, weight }); }
  }
  const explicitBackend = /\b(backend|full[ -]?stack|database|rest api|server-side|authentication|user accounts?)\b/i.test(text);
  const explicitNoBackend = /\b(no|without|do not|don't)\b[^.]{0,45}\b(backend|database|api|auth|authentication|server)\b/i.test(text);
  if (explicitNoBackend) scores.fullstack -= 20;
  if (scores.game >= 6 && !explicitBackend) scores.fullstack -= 8;
  if (scores.code >= 6 && !/\bwebsite|game|full[ -]?stack\b/i.test(text)) scores.code += 3;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  let intent = ranked[0][1] < 3 ? 'app' : ranked[0][0];
  const profile = PROFILES[intent];
  const confidence = Math.max(0.35, Math.min(0.99, 0.55 + Math.max(0, ranked[0][1] - ranked[1][1]) * 0.04));
  return { intent, confidence: Number(confidence.toFixed(2)), option: profile.option, label: profile.label, instructions: profile.instructions, scores, evidence: evidence.sort((a,b)=>b.weight-a.weight).slice(0,10) };
}

function applyIntentGuard(prompt, requestedOption) {
  const classification = classifyBuildIntent(prompt);
  const requested = requestedOption || classification.option;
  return { ...classification, requestedOption: requested, mismatch: requested !== classification.option && classification.confidence >= 0.67 };
}

module.exports = { PROFILES, classifyBuildIntent, applyIntentGuard };
