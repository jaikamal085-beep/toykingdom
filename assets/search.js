'use strict';
/* ==========================================================================
   Hybrid product search (runs in the browser)

   1. Inverted index  - BM25F keyword scoring over name / category / SKU /
                        summary / description, with prefix matching (search-
                        as-you-type), synonyms and typo tolerance.
   2. Vector search   - each product becomes a 512-d hashed vector (words,
                        character trigrams, synonym groups, IDF-weighted);
                        nearest neighbours are found with an HNSW graph.
   3. B-Tree          - the inverted index's term dictionary is a B-Tree, so
                        prefix and typo lookups are ordered range scans, and
                        new terms insert in O(log n).
   Results from 1 and 2 are merged with Reciprocal Rank Fusion.

   Dynamic updates: SEARCH.upsert(product) / SEARCH.remove(id) update both
   indexes in place (no rebuild). Removed vectors are tombstoned and the HNSW
   graph is compacted once more than 30% of it is deleted, which is
   the same idea as an LSM-tree compaction.

   Note on the vectors: they are lexical "semantic-ish" vectors (shared
   word pieces and synonym groups), not neural embeddings, so the whole
   engine stays small and works offline.
   ========================================================================== */
(function () {

  /* ---------------- text processing ---------------- */
  const STOP = new Set('a an and are as at be by for from in into is it its of on or the to with this that your you our'.split(' '));
  const SYN_GROUPS = [
    ['car', 'vehicle', 'automobile', 'racer', 'race', 'racing', 'jeep'],
    ['rc', 'remote', 'radio'],
    ['kid', 'child', 'children', 'toddler', 'baby', 'infant'],
    ['puzzle', 'jigsaw'],
    ['educational', 'learning', 'learn', 'stem', 'montessori', 'brain'],
    ['gift', 'present', 'birthday', 'return'],
    ['light', 'led', 'glow', 'lighting'],
    ['bubble', 'bubbl'],
    ['gun', 'blaster', 'shooter'],
    ['block', 'brick', 'building', 'build'],
    ['plane', 'aeroplane', 'airplane', 'aircraft', 'jet', 'flight'],
    ['drone', 'quadcopter'],
    ['robot', 'bot', 'transform'],
    ['game', 'board'],
    ['music', 'musical', 'piano', 'keyboard', 'sound'],
    ['truck', 'lorry', 'excavator', 'jcb', 'construction'],
    ['bike', 'cycle', 'bicycle', 'scooter'],
    ['hotwheel', 'diecast', 'die', 'metal'],
    ['doll', 'barbie'],
    ['slime', 'clay', 'dough'],
    ['magnetic', 'magnet'],
    ['water', 'pool', 'beach'],
    ['animal', 'dinosaur', 'dino', 'pet'],
  ];

  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’]/g, '');
  function stem(w) {
    if (w.length <= 3 || /\d/.test(w)) return w;
    if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
    if (/(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
    if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
    if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
    if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
    return w;
  }
  const tokenize = s => norm(s).split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t)).map(stem);
  /* adjacent words joined ("hot wheels" -> "hotwheel") so either spelling matches */
  const withCompounds = toks => toks.concat(toks.slice(1).map((t, i) => stem(toks[i] + t)).filter(t => t.length <= 14));

  const SYN_OF = new Map();
  SYN_GROUPS.forEach((g, i) => g.forEach(w => SYN_OF.set(stem(w), i)));
  const synonymsOf = t => { const g = SYN_OF.get(t); return g === undefined ? [] : SYN_GROUPS[g].map(stem); };

  /* Optimal string alignment distance with early exit above `max` */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i]; let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur.push(v); if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[b.length];
  }

  /* ---------------- binary heap ---------------- */
  class Heap {
    constructor(cmp) { this.a = []; this.cmp = cmp; }
    get size() { return this.a.length; }
    peek() { return this.a[0]; }
    push(x) {
      const a = this.a; a.push(x);
      for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (this.cmp(a[i], a[p]) >= 0) break; [a[i], a[p]] = [a[p], a[i]]; i = p; }
    }
    pop() {
      const a = this.a, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < a.length && this.cmp(a[l], a[m]) < 0) m = l;
          if (r < a.length && this.cmp(a[r], a[m]) < 0) m = r;
          if (m === i) break; [a[i], a[m]] = [a[m], a[i]]; i = m;
        }
      }
      return top;
    }
  }

  /* ---------------- B-Tree (ordered map: term -> postings) ---------------- */
  class BTree {
    constructor(t = 16) { this.t = t; this.root = { keys: [], vals: [], kids: null }; this.size = 0; }
    static lb(n, key) { let lo = 0, hi = n.keys.length; while (lo < hi) { const m = (lo + hi) >> 1; if (n.keys[m] < key) lo = m + 1; else hi = m; } return lo; }
    get(key) {
      for (let n = this.root; ;) {
        const i = BTree.lb(n, key);
        if (i < n.keys.length && n.keys[i] === key) return n.vals[i];
        if (!n.kids) return undefined;
        n = n.kids[i];
      }
    }
    set(key, val) {
      if (this.root.keys.length === 2 * this.t - 1) { const s = { keys: [], vals: [], kids: [this.root] }; this.split(s, 0); this.root = s; }
      for (let n = this.root; ;) {
        const i = BTree.lb(n, key);
        if (i < n.keys.length && n.keys[i] === key) { n.vals[i] = val; return; }
        if (!n.kids) { n.keys.splice(i, 0, key); n.vals.splice(i, 0, val); this.size++; return; }
        let c = n.kids[i];
        if (c.keys.length === 2 * this.t - 1) {
          this.split(n, i);
          if (key === n.keys[i]) { n.vals[i] = val; return; }
          c = key > n.keys[i] ? n.kids[i + 1] : n.kids[i];
        }
        n = c;
      }
    }
    split(parent, i) {
      const t = this.t, y = parent.kids[i];
      const z = { keys: y.keys.splice(t), vals: y.vals.splice(t), kids: y.kids ? y.kids.splice(t) : null };
      parent.keys.splice(i, 0, y.keys.pop()); parent.vals.splice(i, 0, y.vals.pop());
      parent.kids.splice(i + 1, 0, z);
    }
    *from(key, n = this.root) {           // in-order traversal starting at the first key >= key
      const i = BTree.lb(n, key);
      if (n.kids) yield* this.from(key, n.kids[i]);
      for (let j = i; j < n.keys.length; j++) { yield [n.keys[j], n.vals[j]]; if (n.kids) yield* this.all(n.kids[j + 1]); }
    }
    *all(n) {
      for (let j = 0; j < n.keys.length; j++) { if (n.kids) yield* this.all(n.kids[j]); yield [n.keys[j], n.vals[j]]; }
      if (n.kids) yield* this.all(n.kids[n.keys.length]);
    }
    *prefix(p) { for (const kv of this.from(p)) { if (!kv[0].startsWith(p)) return; yield kv; } }
  }

  /* ---------------- Inverted index (BM25F) ---------------- */
  const FIELD_W = { name: 3, cats: 2, sku: 2, short: 1, desc: 0.6 };
  class InvertedIndex {
    constructor() { this.terms = new BTree(16); this.docLen = new Map(); this.docTerms = new Map(); this.totalLen = 0; }
    get N() { return this.docLen.size; }
    add(id, fields) {
      this.remove(id);
      const tf = new Map(); let len = 0;
      for (const f in FIELD_W) for (const t of fields[f] || []) { tf.set(t, (tf.get(t) || 0) + FIELD_W[f]); len += FIELD_W[f]; }
      for (const [t, f] of tf) { let p = this.terms.get(t); if (!p) { p = new Map(); this.terms.set(t, p); } p.set(id, f); }
      this.docLen.set(id, len); this.docTerms.set(id, [...tf.keys()]); this.totalLen += len;
    }
    remove(id) {
      const ts = this.docTerms.get(id); if (!ts) return;
      for (const t of ts) { const p = this.terms.get(t); if (p) p.delete(id); }   // empty postings are skipped (tombstones)
      this.totalLen -= this.docLen.get(id); this.docLen.delete(id); this.docTerms.delete(id);
    }
    has(t) { const p = this.terms.get(t); return !!(p && p.size); }
    score(weighted) {                      // Map(term -> query weight) => Map(id -> score)
      const k1 = 1.2, b = 0.75, avg = this.totalLen / Math.max(1, this.N), out = new Map();
      for (const [t, qw] of weighted) {
        const p = this.terms.get(t); if (!p || !p.size) continue;
        const idf = Math.log(1 + (this.N - p.size + 0.5) / (p.size + 0.5));
        for (const [id, f] of p) {
          const s = idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * this.docLen.get(id) / avg));
          out.set(id, Math.max(out.get(id) || 0, qw * s));   // best expansion of this query word
        }
      }
      return out;
    }
  }

  /* ---------------- hashed feature vectors ---------------- */
  const DIM = 512;
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
  class Vectorizer {
    constructor() { this.df = new Map(); this.docFeats = new Map(); this.N = 0; }
    features(fields, weights) {
      const f = new Map(), add = (k, w) => f.set(k, (f.get(k) || 0) + w);
      for (const [field, fw] of weights) for (const t of fields[field] || []) {
        add('w:' + t, fw);
        const g = SYN_OF.get(t); if (g !== undefined) add('g:' + g, fw);
        const s = '^' + t + '$'; for (let i = 0; i + 3 <= s.length; i++) add('c:' + s.slice(i, i + 3), 0.3 * fw);
      }
      return f;
    }
    observe(id, f) { this.forget(id); this.docFeats.set(id, [...f.keys()]); for (const k of f.keys()) this.df.set(k, (this.df.get(k) || 0) + 1); this.N++; }
    forget(id) {
      const ks = this.docFeats.get(id); if (!ks) return;
      for (const k of ks) { const v = this.df.get(k) - 1; if (v > 0) this.df.set(k, v); else this.df.delete(k); }
      this.docFeats.delete(id); this.N--;
    }
    /* share of a query's features that exist in at least one product (0..1) */
    known(f) { let all = 0, hit = 0; for (const [k, w] of f) { all += w; if (this.df.get(k)) hit += w; } return all ? hit / all : 0; }
    embed(f) {
      const v = new Float32Array(DIM);
      for (const [k, w] of f) {
        const df = this.df.get(k) || 0;
        if (!df) continue;                 // a feature no product has can only add hash-collision noise
        const h = fnv(k), idf = Math.log((this.N + 1) / (df + 1)) + 1;
        v[h % DIM] += ((h >>> 16) & 1 ? 1 : -1) * w * idf;
      }
      let n = 0; for (let i = 0; i < DIM; i++) n += v[i] * v[i];
      n = Math.sqrt(n) || 1; for (let i = 0; i < DIM; i++) v[i] /= n;
      return v;
    }
  }

  /* ---------------- HNSW (approximate nearest neighbours, cosine) ---------------- */
  function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  class HNSW {
    constructor({ M = 12, efConstruction = 80, seed = 7 } = {}) { this.M = M; this.M0 = 2 * M; this.efC = efConstruction; this.mL = 1 / Math.log(M); this.seed = seed; this.reset(); }
    reset() { this.nodes = new Map(); this.keyOf = new Map(); this.seq = 0; this.entry = null; this.maxLevel = -1; this.deleted = 0; this.rand = rng(this.seed); }
    dist(a, b) { return 1 - dot(a, b); }
    layer(q, eps, ef, l) {
      const seen = new Set(eps), cand = new Heap((a, b) => a.d - b.d), best = new Heap((a, b) => b.d - a.d);
      for (const k of eps) { const d = this.dist(q, this.nodes.get(k).vec); cand.push({ k, d }); best.push({ k, d }); }
      while (cand.size) {
        const c = cand.pop();
        if (c.d > best.peek().d && best.size >= ef) break;
        for (const nb of this.nodes.get(c.k).links[l] || []) {
          if (seen.has(nb)) continue; seen.add(nb);
          const d = this.dist(q, this.nodes.get(nb).vec);
          if (best.size < ef || d < best.peek().d) { cand.push({ k: nb, d }); best.push({ k: nb, d }); if (best.size > ef) best.pop(); }
        }
      }
      return best.a.slice().sort((a, b) => a.d - b.d);
    }
    select(cands, M) {                     // neighbour-selection heuristic (keeps the graph diverse)
      const out = [];
      for (const c of cands) {
        if (out.length >= M) break;
        const cv = this.nodes.get(c.k).vec;
        if (out.every(o => this.dist(cv, this.nodes.get(o.k).vec) >= c.d)) out.push(c);
      }
      for (const c of cands) { if (out.length >= M) break; if (!out.includes(c)) out.push(c); }
      return out;
    }
    insert(id, vec) {
      this.remove(id);
      const key = this.seq++, level = Math.floor(-Math.log(1 - this.rand()) * this.mL);
      const node = { id, vec, links: Array.from({ length: level + 1 }, () => []), deleted: false };
      this.nodes.set(key, node); this.keyOf.set(id, key);
      if (this.entry === null) { this.entry = key; this.maxLevel = level; return; }
      let eps = [this.entry];
      for (let l = this.maxLevel; l > level; l--) eps = [this.layer(vec, eps, 1, l)[0].k];
      for (let l = Math.min(level, this.maxLevel); l >= 0; l--) {
        const W = this.layer(vec, eps, this.efC, l), cap = l ? this.M : this.M0;
        const nbs = this.select(W, this.M);
        node.links[l] = nbs.map(n => n.k);
        for (const nb of nbs) {
          const nn = this.nodes.get(nb.k), L = nn.links[l];
          L.push(key);
          if (L.length > cap) nn.links[l] = this.select(L.map(k => ({ k, d: this.dist(nn.vec, this.nodes.get(k).vec) })).sort((a, b) => a.d - b.d), cap).map(x => x.k);
        }
        eps = W.map(w => w.k);
      }
      if (level > this.maxLevel) { this.maxLevel = level; this.entry = key; }
    }
    remove(id) {
      const key = this.keyOf.get(id); if (key === undefined) return;
      this.nodes.get(key).deleted = true; this.keyOf.delete(id); this.deleted++;
      if (this.deleted > 16 && this.deleted > this.nodes.size * 0.3) this.compact();
    }
    compact() { const live = [...this.nodes.values()].filter(n => !n.deleted); this.reset(); live.forEach(n => this.insert(n.id, n.vec)); }
    search(q, k, ef = 64) {
      if (this.entry === null) return [];
      let eps = [this.entry];
      for (let l = this.maxLevel; l > 0; l--) eps = [this.layer(q, eps, 1, l)[0].k];
      return this.layer(q, eps, Math.max(ef, k), 0)
        .filter(w => !this.nodes.get(w.k).deleted).slice(0, k)
        .map(w => ({ id: this.nodes.get(w.k).id, sim: 1 - w.d }));
    }
  }

  /* ---------------- hybrid engine ---------------- */
  const VEC_W = [['name', 2], ['cats', 1], ['short', 0.5]];
  const fieldsOf = p => ({
    name: withCompounds(tokenize(p.name)),
    cats: tokenize((p.cats || []).join(' ')),
    sku: p.sku ? [norm(p.sku).replace(/[^a-z0-9]/g, ''), ...tokenize(p.sku)] : [],
    short: tokenize(p.short),
    desc: tokenize(String(p.desc || '').slice(0, 1500)),
  });

  class HybridSearch {
    constructor() { this.inv = new InvertedIndex(); this.vec = new Vectorizer(); this.hnsw = new HNSW(); this.byId = new Map(); }
    build(products) {
      const all = products.map(p => [String(p.id), p, fieldsOf(p)]);
      all.forEach(([id, , f]) => this.vec.observe(id, this.vec.features(f, VEC_W)));     // corpus statistics first
      all.forEach(([id, p, f]) => this.index(id, p, f));
      return this;
    }
    index(id, p, f) {
      this.byId.set(id, p);
      this.inv.add(id, f);
      this.hnsw.insert(id, this.vec.embed(this.vec.features(f, VEC_W)));
    }
    upsert(p) {
      const id = String(p.id), f = fieldsOf(p);
      this.remove(id);
      this.vec.observe(id, this.vec.features(f, VEC_W));
      this.index(id, p, f);
    }
    remove(id) { id = String(id); this.inv.remove(id); this.hnsw.remove(id); this.vec.forget(id); this.byId.delete(id); }

    expand(tok, isLast, typing) {
      const out = new Map(), set = (t, w) => { if (w > (out.get(t) || 0)) out.set(t, w); };
      if (this.inv.has(tok)) set(tok, 1);
      if (((typing && isLast) || !out.size) && tok.length >= 2) {   // search-as-you-type: B-Tree prefix range scan
        let n = 0; for (const [k, p] of this.inv.terms.prefix(tok)) { if (k !== tok && p.size) { set(k, 0.8); if (++n >= 30) break; } }
      }
      for (const s of synonymsOf(tok)) if (s !== tok && this.inv.has(s)) set(s, 0.6);
      if (!out.size && tok.length >= 4) {                       // typo tolerance, scanning only terms with the same first letter
        const max = tok.length >= 8 ? 2 : 1;
        for (const [k, p] of this.inv.terms.prefix(tok[0])) if (p.size && editDistance(tok, k, max) <= max) set(k, 0.5);
      }
      return out;
    }

    /* typing: true while the user is still typing (last word may be incomplete) */
    query(raw, { limit = 60, typing = false } = {}) {
      let toks = [...new Set(tokenize(raw))];
      /* while typing, a single trailing letter ("bubble g") is not a word yet */
      if (typing && toks.length > 1 && toks[toks.length - 1].length < 2) toks = toks.slice(0, -1);
      if (!toks.length) return [];
      const n = toks.length;

      /* 1. keyword side: every query word must be explained, partial matches are penalised */
      const lex = new Map();
      toks.forEach((t, i) => {
        for (const [id, s] of this.inv.score(this.expand(t, i === n - 1, typing))) {
          const e = lex.get(id) || { s: 0, cov: 0 }; e.s += s; e.cov++; lex.set(id, e);
        }
      });
      let lexRank = [...lex].map(([id, e]) => ({ id, s: e.s * (e.cov / n) ** 2, full: e.cov === n })).sort((a, b) => b.s - a.s);
      const fullMatches = lexRank.filter(r => r.full).length;
      if (fullMatches) lexRank = lexRank.filter(r => r.full);   // products matching every word win; partial matches only as a fallback

      /* 2. vector side: nearest neighbours in the HNSW graph */
      const qf = this.vec.features({ q: withCompounds(toks) }, [['q', 1]]);
      const qv = this.vec.known(qf) >= 0.5 ? this.vec.embed(qf) : null;   // mostly-unknown query: vectors would only add noise
      /* weak similarities (< ~0.25) are just shared letter patterns, so they are noise.
         With good keyword hits, only very similar extras are added. */
      const minSim = fullMatches ? 0.36 : 0.30;
      const semRank = qv ? this.hnsw.search(qv, 40).filter(r => r.sim >= minSim) : [];

      /* 3. Reciprocal Rank Fusion + small boosts */
      const K = 60, fused = new Map(), add = (id, v) => fused.set(id, (fused.get(id) || 0) + v);
      lexRank.slice(0, 200).forEach((r, i) => add(r.id, (r.full ? 1 : 0.5) / (K + i + 1)));
      semRank.forEach((r, i) => add(r.id, 0.7 / (K + i + 1)));
      const phrase = norm(raw).trim();
      for (const id of fused.keys()) {
        const p = this.byId.get(id); if (!p) { fused.delete(id); continue; }
        if (phrase.length > 2 && norm(p.name).includes(phrase)) add(id, 0.004);
        if (p.stock) add(id, 0.0005);
      }
      return [...fused].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, score]) => ({ id, score, product: this.byId.get(id) }));
    }
  }

  /* ---------------- public API ---------------- */
  let engine = null;
  window.SEARCH = {
    ready() { if (!engine) engine = new HybridSearch().build(PRODUCTS); return engine; },
    query(q, opts) { return this.ready().query(q, opts); },
    upsert(p) { if (engine) engine.upsert(p); },
    remove(id) { if (engine) engine.remove(id); },
    _internals: { tokenize, editDistance, BTree, HNSW, HybridSearch },
  };
})();
