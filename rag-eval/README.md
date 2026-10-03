# Retrieval eval: did the right chunks come back?

The [LLM-as-judge](../judge/scoring.md) is a **generation** eval. It scores the reply *given* the retrieved context. That leaves a blind spot: if retrieval returned the wrong chunks, a careful reply built on them can still score well, and nothing flags that retrieval failed.

The blind spot is real. One question in the suite ("What LLM evaluation metrics does the subject know?") missed its expected chunk **every night**, and the generation judge still scored the reply **5/5**. The reply was fluent and grounded in what *was* retrieved, just not in the chunk that best answered the question.

This layer scores the **retrieval** half on its own. Inside the chatbot's roadmap it's Phase 8A. The retrieval change it led to (Phase 8C) is written up in [hybrid-vs-reranker.md](hybrid-vs-reranker.md).

## The metrics

Every in-corpus case lists the chunk heading(s) a correct retrieval should include (`expectedHeadings`). Three metrics run against the top 4 chunks the chatbot retrieves:

| Metric | Question it answers | Model call? |
|---|---|---|
| **Context precision@k** | Are the right chunks near the **top**? Ragas-style: average the precision at each rank where a right chunk appears, so a right chunk at rank 1 counts more than one at rank 4. | No |
| **MRR** (mean reciprocal rank) | How high is the **first** right chunk? 1.0 at rank 1, 0.5 at rank 2, 0 if absent. | No |
| **Context recall** | Did retrieval return **everything the answer needs**? Each case carries a short `groundTruth` reference answer. The small judge splits it into claims and marks each one supported or unsupported by the retrieved context; recall = supported ÷ total. | Yes, one small-model call per case |

The two ranking metrics are pure functions:

```ts
// Ragas-style context precision @ k. Returns null for out-of-corpus cases
// (no "right chunk", so precision is undefined).
function contextPrecisionAtK(sources: string[], expected: string[]): number | null {
  if (!expected.length) return null;
  const relevant = new Set(expected);
  let relevantSoFar = 0;
  let sum = 0;
  sources.forEach((heading, i) => {
    if (relevant.has(heading)) {
      relevantSoFar += 1;
      sum += relevantSoFar / (i + 1);
    }
  });
  return relevantSoFar ? sum / relevantSoFar : 0;
}

function reciprocalRank(sources: string[], expected: string[]): number | null {
  if (!expected.length) return null;
  const firstHit = sources.findIndex((h) => expected.includes(h));
  return firstHit === -1 ? 0 : 1 / (firstHit + 1);
}
```

Context recall uses the same small judge model as generation scoring (8B class, not the 70B reply model), for the same reason: a second, cheaper model, so the reply model isn't grading its own homework.

## Out-of-corpus cases: the inverted check

Some questions have no answer in the corpus at all, such as an exact start date or a favorite language. There's no "right chunk" to score, so the check is inverted: the **best similarity score** among the retrieved chunks should stay *low*. A strongly similar chunk on a question the corpus can't answer is how fabrication starts. The model sees confident-looking context and fills the gap.

**What the data showed:** with `bge-base-en-v1.5` embeddings, cosine scores are compressed. Out-of-corpus questions scored a top cosine of 0.68–0.71, while some genuinely in-corpus questions scored 0.63. **No single cosine cutoff separates them.** So the check is advisory, and it now records keyword (BM25) scores alongside cosine, to test whether a combined signal separates the two groups better.

A cross-encoder reranker's score was the planned fix. It didn't work either: the reranker gave some correct in-corpus chunks scores of 0.01–0.04, the same range as out-of-corpus questions. See [hybrid-vs-reranker.md](hybrid-vs-reranker.md).

## Design decisions

- **Advisory, not blocking.** A legitimately thin-context question caps at low precision, so there's no clean pass/fail line. A low mean prints a warning; it never fails the run. (The generation judge *does* gate CI. See [judge/scoring.md](../judge/scoring.md).)
- **Its own time series.** One row per in-corpus case per run, in a separate table from the generation scores, so retrieval trends can be read on their own.
- **Cheap by construction.** Precision, MRR and the out-of-corpus check need no model call; only recall does. The whole layer adds a few hundred neurons to a nightly run, on a Workers AI free tier of 10K/day shared with other projects.

## What three weeks of nightlies taught

The layer baked for three weeks before anything was changed on its evidence:

- **Retrieval found the facts but didn't rank them first.** Mean context recall was **0.99** (the needed information was almost always somewhere in the top 4). Context precision and MRR sat at **0.75**: the best chunk often wasn't ranked first. That pointed at *ranking*, not coverage, as the thing to fix.
- **The nightly is deterministic, so waiting longer adds nothing.** Embeddings are deterministic, and the vector search was returning the same results, so precision came out identical every night: 0.75, night after night. Once a baseline exists, more nights of the same cases add no information. Only new cases or a change to retrieval does.
- **Small n is the real limit.** The smoke nightly scores retrieval on 6 cases; the full suite has 17 cases with expected chunks. At n=17, one case moves a mean by about 0.06. That's why the retrieval change in [hybrid-vs-reranker.md](hybrid-vs-reranker.md) was measured offline over all 17, and why a larger synthetic test set (Ragas) is the next planned step.

## Files

| File | What |
|---|---|
| [hybrid-vs-reranker.md](hybrid-vs-reranker.md) | The retrieval experiment this layer made possible: a cross-encoder reranker vs. hybrid search, every result, and why hybrid shipped |
| [hybrid-reference.ts](hybrid-reference.ts) | The shipped hybrid ranking (BM25 + Reciprocal Rank Fusion): self-contained and type-checked in CI |
