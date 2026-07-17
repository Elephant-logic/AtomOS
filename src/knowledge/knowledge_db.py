#!/usr/bin/env python3
import json, os, sqlite3, sys, datetime

DB_PATH = os.environ.get('ATOMOS_KNOWLEDGE_DB', os.path.join(os.getcwd(), 'data', 'atomos-knowledge.db'))
SCHEMA = '''
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS atoms (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, description TEXT DEFAULT '',
 status TEXT NOT NULL DEFAULT 'learned' CHECK(status IN ('learned','tested','approved')),
 confidence REAL NOT NULL DEFAULT 0.5, version INTEGER NOT NULL DEFAULT 1,
 source_file TEXT DEFAULT '', metadata_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS implementations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, atom_id TEXT NOT NULL, language TEXT NOT NULL,
 source TEXT NOT NULL, runtime TEXT DEFAULT '', UNIQUE(atom_id, language, source),
 FOREIGN KEY(atom_id) REFERENCES atoms(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS connectors (
 atom_id TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('input','output')),
 connector TEXT NOT NULL, UNIQUE(atom_id,direction,connector),
 FOREIGN KEY(atom_id) REFERENCES atoms(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tags (
 atom_id TEXT NOT NULL, tag TEXT NOT NULL, UNIQUE(atom_id,tag),
 FOREIGN KEY(atom_id) REFERENCES atoms(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS usage (
 atom_id TEXT PRIMARY KEY, successful_builds INTEGER NOT NULL DEFAULT 0,
 failed_builds INTEGER NOT NULL DEFAULT 0, last_used_at TEXT,
 FOREIGN KEY(atom_id) REFERENCES atoms(id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE IF NOT EXISTS atom_search USING fts5(id UNINDEXED, name, kind, description, tags);
'''

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def slug(value):
    import re
    text = re.sub(r'[^a-z0-9]+', '-', str(value or 'atom').lower()).strip('-')
    return text or 'atom'

def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    return db

def atom_payload(row, db):
    atom = dict(row)
    atom['metadata'] = json.loads(atom.pop('metadata_json') or '{}')
    atom['connectors'] = {'inputs': [], 'outputs': []}
    for c in db.execute('SELECT direction,connector FROM connectors WHERE atom_id=? ORDER BY connector', (atom['id'],)):
        atom['connectors']['inputs' if c['direction']=='input' else 'outputs'].append(c['connector'])
    atom['tags'] = [x['tag'] for x in db.execute('SELECT tag FROM tags WHERE atom_id=? ORDER BY tag', (atom['id'],))]
    atom['implementations'] = {}
    for impl in db.execute('SELECT language,source,runtime FROM implementations WHERE atom_id=? ORDER BY id', (atom['id'],)):
        atom['implementations'].setdefault(impl['language'], []).append({'source': impl['source'], 'runtime': impl['runtime']})
    use = db.execute('SELECT successful_builds,failed_builds,last_used_at FROM usage WHERE atom_id=?', (atom['id'],)).fetchone()
    atom['usage'] = dict(use) if use else {'successful_builds':0,'failed_builds':0,'last_used_at':None}
    return atom

def upsert_atom(db, raw):
    name = str(raw.get('name') or raw.get('id') or 'Atom')[:160]
    kind = str(raw.get('kind') or raw.get('semanticKind') or 'source.part')[:120]
    atom_id = slug(raw.get('id') or f'{kind}-{name}')[:180]
    metadata = raw.get('metadata') or {}
    if raw.get('html'): metadata['html'] = raw['html']
    atomos = raw.get('atomos') or {}
    implementations = raw.get('implementations') or atomos.get('implementations') or {}
    connectors = raw.get('connectors') or {}
    tags = raw.get('tags') or []
    ts = now()
    db.execute('''INSERT INTO atoms(id,name,kind,description,status,confidence,version,source_file,metadata_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,
      description=excluded.description,confidence=MAX(atoms.confidence,excluded.confidence),version=atoms.version+1,
      source_file=excluded.source_file,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at''',
      (atom_id,name,kind,str(raw.get('description') or '')[:1000],str(raw.get('status') or 'learned'),float(raw.get('confidence') or .5),1,str(raw.get('sourceFile') or '')[:500],json.dumps(metadata),ts,ts))
    for direction, values in [('input', connectors.get('inputs', [])), ('output', connectors.get('outputs', []))]:
        for value in values[:100]: db.execute('INSERT OR IGNORE INTO connectors(atom_id,direction,connector) VALUES(?,?,?)',(atom_id,direction,str(value)[:300]))
    for tag in tags[:50]: db.execute('INSERT OR IGNORE INTO tags(atom_id,tag) VALUES(?,?)',(atom_id,str(tag)[:100]))
    for language, value in implementations.items():
        entries = value if isinstance(value, list) else [value]
        for entry in entries[:20]:
            source = entry.get('source','') if isinstance(entry,dict) else str(entry)
            runtime = entry.get('runtime','') if isinstance(entry,dict) else ''
            if source: db.execute('INSERT OR IGNORE INTO implementations(atom_id,language,source,runtime) VALUES(?,?,?,?)',(atom_id,str(language)[:60],source[:100000],str(runtime)[:120]))
    db.execute('INSERT OR IGNORE INTO usage(atom_id) VALUES(?)',(atom_id,))
    tag_text = ' '.join(str(x) for x in tags)
    db.execute('DELETE FROM atom_search WHERE id=?',(atom_id,))
    db.execute('INSERT INTO atom_search(id,name,kind,description,tags) VALUES(?,?,?,?,?)',(atom_id,name,kind,str(raw.get('description') or ''),tag_text))
    return atom_id

def handle(req):
    db = connect(); op = req.get('op')
    try:
        if op == 'init': return {'ok':True,'database':DB_PATH}
        if op == 'import':
            atoms = req.get('atoms') or []
            ids = [upsert_atom(db, atom) for atom in atoms[:1000]]
            db.commit(); return {'ok':True,'imported':len(ids),'ids':ids}
        if op == 'search':
            q = str(req.get('q') or '').strip(); limit = min(max(int(req.get('limit') or 30),1),100)
            if q:
                rows = db.execute('''SELECT a.* FROM atom_search s JOIN atoms a ON a.id=s.id
                    WHERE atom_search MATCH ? ORDER BY bm25(atom_search), a.status DESC, a.confidence DESC LIMIT ?''',(q.replace('"',' '),limit)).fetchall()
            else:
                rows = db.execute('SELECT * FROM atoms ORDER BY updated_at DESC LIMIT ?',(limit,)).fetchall()
            return {'ok':True,'results':[atom_payload(x,db) for x in rows]}
        if op == 'get':
            row = db.execute('SELECT * FROM atoms WHERE id=?',(req.get('id'),)).fetchone()
            return {'ok':bool(row),'atom':atom_payload(row,db) if row else None}
        if op == 'status':
            status = str(req.get('status') or '')
            if status not in ('learned','tested','approved'): raise ValueError('Invalid status')
            db.execute('UPDATE atoms SET status=?,updated_at=? WHERE id=?',(status,now(),req.get('id'))); db.commit()
            return {'ok':db.total_changes>0}
        if op == 'record_usage':
            success = bool(req.get('success')); atom_id=req.get('id')
            field = 'successful_builds' if success else 'failed_builds'
            db.execute(f'UPDATE usage SET {field}={field}+1,last_used_at=? WHERE atom_id=?',(now(),atom_id)); db.commit(); return {'ok':db.total_changes>0}
        if op == 'stats':
            total=db.execute('SELECT COUNT(*) n FROM atoms').fetchone()['n']
            statuses={r['status']:r['n'] for r in db.execute('SELECT status,COUNT(*) n FROM atoms GROUP BY status')}
            kinds=[dict(r) for r in db.execute("SELECT substr(kind,1,instr(kind||'.','.')-1) category,COUNT(*) count FROM atoms GROUP BY category ORDER BY count DESC LIMIT 20")]
            languages=[dict(r) for r in db.execute('SELECT language,COUNT(DISTINCT atom_id) count FROM implementations GROUP BY language ORDER BY count DESC')]
            return {'ok':True,'total':total,'statuses':statuses,'categories':kinds,'languages':languages,'database':DB_PATH}
        raise ValueError('Unknown operation')
    finally: db.close()

try:
    request=json.loads(sys.stdin.read() or '{}')
    print(json.dumps(handle(request)))
except Exception as exc:
    print(json.dumps({'ok':False,'error':str(exc)})); sys.exit(1)
