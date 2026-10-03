// Hybrid retrieval: cosine (embedding) ranking + BM25 (keyword) ranking,
// merged with Reciprocal Rank Fusion. Reference copy of the function the
// chatbot runs in production, with comments generalised for this repo.
// Why it shipped instead of a cross-encoder reranker: hybrid-vs-reranker.md.
//
// Context: the corpus is ~60 hand-written chunks, bundled into the Worker,
// so BM25 scores every chunk in memory (about a millisecond, no model call).
// Cosine candidates come from a vector index (Cloudflare Vectorize) as
// { id, score }, best first.
//
// Self-contained (no imports) so it type-checks on its own:
//   npx -y -p typescript tsc --noEmit --strict --target es2022 rag-eval/hybrid-reference.ts

// The shape of one corpus chunk.
export interface CorpusChunk {
  id: string;
  heading: string;
  text: string;
}

// How many cosine candidates to fetch from Vectorize. 20 is Vectorize's
// maximum when metadata is returned (which LangChain's store always asks
// for). BM25 always scores all 60 chunks, so a chunk cosine ranks 21st or
// lower can still be pulled in by its keywords.
export const HYBRID_COSINE_K = 20;

// RRF's standard constant (from the original 2009 paper). Bigger values
// flatten the difference between rank 1 and rank 10. 60 is the usual
// default; deliberately not tuned on 17 eval cases.
export const RRF_K = 60;

// BM25's two standard settings: k1 caps how much repeating a word keeps
// helping, b controls how much long chunks are penalised. These are the
// textbook defaults, also not tuned.
const BM25_K1 = 1.2;
const BM25_B = 0.75;

// Common English words that carry no meaning for search. A standard list,
// not tuned to the eval questions -- in particular it does NOT drop
// the subject's first name, even though removing it (plus a few question
// words) scored better offline (precision 0.828 vs 0.794), because those
// words were picked by looking at the eval questions -- fitting the list to
// the test set.
const STOPWORDS = new Set(
  (
    "a an the and or of to in on for with is are was were be been what how do does did " +
    "you your i my it this that he his has have about me"
  ).split(" ")
);

// Lowercases, keeps letters/digits plus a few characters that matter inside
// technical terms (e.g. "c++", "@k", "langchain.js"), and drops stopwords.
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9@#+.\- ]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter((w) => w && !STOPWORDS.has(w));
}

export interface Bm25Index {
  chunks: CorpusChunk[];
  termFreqs: Map<string, number>[];
  lengths: number[];
  avgLength: number;
  docFreq: Map<string, number>;
}

// Pre-computes the word counts BM25 needs, once. Each chunk is indexed as
// heading + text, same as what the reply model is shown.
export function buildBm25Index(chunks: CorpusChunk[]): Bm25Index {
  const termFreqs = chunks.map((c) => {
    const tf = new Map<string, number>();
    for (const w of tokenize(`${c.heading} ${c.text}`)) tf.set(w, (tf.get(w) ?? 0) + 1);
    return tf;
  });
  const lengths = termFreqs.map((tf) => [...tf.values()].reduce((a, b) => a + b, 0));
  const docFreq = new Map<string, number>();
  for (const tf of termFreqs) for (const w of tf.keys()) docFreq.set(w, (docFreq.get(w) ?? 0) + 1);
  const avgLength = lengths.reduce((a, b) => a + b, 0) / Math.max(chunks.length, 1);
  return { chunks, termFreqs, lengths, avgLength, docFreq };
}

// BM25 score of every chunk for `query`, same order as index.chunks. A word
// that appears in few chunks (high "inverse document frequency") counts for
// more than one that appears everywhere.
export function bm25Scores(index: Bm25Index, query: string): number[] {
  const n = index.chunks.length;
  const words = [...new Set(tokenize(query))];
  return index.termFreqs.map((tf, i) => {
    let score = 0;
    for (const w of words) {
      const f = tf.get(w);
      if (!f) continue;
      const df = index.docFreq.get(w)!;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      const norm = 1 - BM25_B + BM25_B * (index.lengths[i] / index.avgLength);
      score += (idf * (f * (BM25_K1 + 1))) / (f + BM25_K1 * norm);
    }
    return score;
  });
}

export interface HybridHit {
  chunk: CorpusChunk;
  // Cosine score from Vectorize, or null when the chunk wasn't in the
  // cosine top HYBRID_COSINE_K (it was found by keywords alone).
  cosine: number | null;
  bm25: number;
  fused: number;
}

// Merges the cosine ranking (Vectorize's matches, best first, by chunk id)
// with BM25 over the whole corpus, and returns the best `topK` by RRF score.
// Ties keep cosine order. Cosine ids that aren't in the corpus (a stale
// Vectorize index) are skipped, since there's no text to show for them.
export function hybridRank(
  cosineMatches: { id: string; score: number }[],
  query: string,
  topK: number,
  index: Bm25Index
): HybridHit[] {
  const bm25 = bm25Scores(index, query);
  const byId = new Map(index.chunks.map((c, i) => [c.id, i]));

  const fused = new Map<number, number>();
  const cosineById = new Map<number, number>();
  cosineMatches.forEach((m, rank) => {
    const i = byId.get(m.id);
    if (i === undefined || cosineById.has(i)) return;
    cosineById.set(i, m.score);
    fused.set(i, 1 / (RRF_K + rank + 1));
  });
  // Only chunks that actually contain a query word get a BM25 rank; a
  // chunk with score 0 matched nothing and shouldn't be boosted.
  bm25
    .map((score, i) => ({ score, i }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .forEach(({ i }, rank) => fused.set(i, (fused.get(i) ?? 0) + 1 / (RRF_K + rank + 1)));

  // Tie-break: cosine rank, with keyword-only chunks after every cosine one
  // (a large finite number, not Infinity -- Infinity - Infinity is NaN,
  // which would make the sort order undefined).
  const cosineOrder = new Map([...cosineById.keys()].map((i, r) => [i, r]));
  const tieRank = (i: number) => cosineOrder.get(i) ?? Number.MAX_SAFE_INTEGER;
  return [...fused.entries()]
    .sort(([a, fa], [b, fb]) => fb - fa || tieRank(a) - tieRank(b))
    .slice(0, topK)
    .map(([i, score]) => ({
      chunk: index.chunks[i],
      cosine: cosineById.get(i) ?? null,
      bm25: bm25[i],
      fused: score,
    }));
}
