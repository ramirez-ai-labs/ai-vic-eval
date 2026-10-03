# The reranker made retrieval worse. Hybrid search shipped instead.

**What was planned:** a cross-encoder reranker on top of embedding search, the textbook second stage.
**What shipped:** hybrid search, which merges the embedding ranking and a keyword (BM25) ranking with Reciprocal Rank Fusion. [Reference code](hybrid-reference.ts).
**Why:** measured against the [retrieval eval](README.md), the reranker alone scored *below* the baseline. Hybrid scored best of everything untuned, and costs no model call.

## The setup

- **Corpus:** about 60 hand-written chunks about one person, embedded with `bge-base-en-v1.5` (768 dimensions) in a vector index.
- **Before:** plain cosine top-4. Embed the question, take the 4 nearest chunks, and put them in the reply model's context.
- **Symptom:** after three weeks of nightlies, context precision and MRR held at 0.75. Recall was near 1.0, but the best chunk often wasn't ranked first.
- **Budget:** Workers AI free tier, 10K neurons/day shared with other projects. A chat reply on the 70B model costs about 190.

## How it was measured

Over the **17 eval cases that list an expected chunk**, using the same three metrics as the nightly: context precision@4, MRR and Recall@4.

**Offline, not through the chatbot.** Comparing two full eval runs through the live chatbot would mean a 70B reply per case per run, a large bite of the shared daily budget. Instead, an offline harness reproduces production retrieval:
- the same embedding model,
- the same cosine ranking the vector index does, cut to the same top 20,
- then the **same ranking function the production code runs**, imported rather than reimplemented.

It makes only embedding calls (a few neurons). BM25 needs no model at all.

**Checked against production.** A preview deployment, which serves no live traffic, was asked several of the changed questions. Its retrieved chunks and precision matched the harness exactly, and cosine scores matched to 4 decimal places.

## Results

| Strategy | Precision@4 | MRR | Recall@4 | Cases better / worse | Extra cost per chat |
|---|---|---|---|---|---|
| Cosine top-4 (before) | 0.721 | 0.721 | 0.941 | n/a | n/a |
| Cross-encoder reranker alone (cosine top-10 → rerank → 4) | 0.696 | 0.706 | 0.824 | +3 / −5 | 1 model call, ~2.6 neurons |
| 0.5 × cosine + 0.5 × rerank score | 0.775 | 0.770 | 0.941 | +3 / −1 | 1 model call, ~2.6 neurons |
| BM25 alone | 0.696 | 0.706 | 0.882 | +4 / −5 | none |
| **Hybrid: cosine top-20 + BM25, merged by RRF (shipped)** | **0.794** | **0.814** | **0.941** | **+4 / −2** | **none** |
| Hybrid, with a stopword list tuned to these questions | 0.828 | 0.853 | 0.941 | +5 / −1 | none, but **not shipped** |

What hybrid changed, case by case (precision, before → after):

| Question (paraphrased) | Before | After |
|---|---|---|
| "What has the subject been publishing or writing about lately?" | 0.25 | **1.00** |
| "Does the subject write about anything besides AI?" | 0.33 | **1.00** |
| "What's your management experience?" | 0.50 | **0.83** |
| "What's the subject's experience with MCP?" | 0.33 | **0.50** |
| "What repos has the subject built for RAG evaluation?" | 1.00 | 0.83 (the right chunk is still in the top 4) |
| "Where can I find the subject on LinkedIn?" | 1.00 | 0.50 (the right chunk is still in the top 4) |

## What it taught

### 1. The textbook second stage made things worse

`bge-reranker-base` is a general-purpose cross-encoder, trained on web search pairs. Here it fixed 3 cases and broke 5. Likely reasons:

- **Voice mismatch:** the corpus is written in first person ("I built…"), and the questions are in third person ("What has the subject…").
- **Poor calibration on this corpus:** it gave some *correct* chunks top scores of 0.01–0.04.

Blending its score 50/50 with cosine recovered most of the damage, but still cost a model call on every chat.

### 2. Hybrid won mostly on cost and simplicity

Hybrid had the best untuned precision and MRR. But its lead over the 50/50 blend is about one case's worth at n=17, so **on quality alone they're roughly tied.** What decides it:

- **No model call and no network call:** BM25 over ~60 bundled chunks runs in memory in about a millisecond.
- **No new failure mode:** the reranker needed its own timeout and a fallback path.
- **Gains in the right place:** the biggest wins are questions where one word ("writing", "publishing") points straight at the right chunk, which is exactly what keyword search is for.

### 3. Don't tune on the test set

With 17 cases, any parameter chosen to maximize the score is partly fitted to those 17 questions. So everything shipped untuned:

- **RRF k = 60:** the original paper's constant.
- **BM25 k1 = 1.2, b = 0.75:** textbook defaults.
- **Stopwords:** a standard English list.

Removing the subject's first name and a few question words scored higher (0.828 / 0.853). It wasn't shipped, because those words were chosen by looking at the test questions.

### 4. Batching your eval queries can lie to you

The first offline runs embedded all 17 questions **in one batch**. Batching shifts the embedding vectors very slightly (padding effects), which is enough to flip near-tied rankings. That run claimed hybrid fixed a known miss and raised Recall@4 to 1.000. **The preview deployment disagreed.**

Embedding one question per call, the way the production chat path does, made the harness match production exactly. The corrected numbers are the ones above. **If an offline harness doesn't call the model the way production does, it isn't measuring production.**

### 5. Measure model costs; don't estimate them

The reranker's cost was first estimated from the per-token price list as "under 1 neuron per call". The dashboard, read after the experiment, showed **~2.6 per call**, about 3× higher. The experiment itself (mostly live-preview chats on the 70B, plus embedding runs) used a large share of one day's shared budget. Two lessons:

- Read real costs off the usage dashboard.
- Run experiments right after the daily quota reset, and keep live-preview checks to a handful.

### 6. Still unsolved: one stubborn miss

"What LLM evaluation metrics does the subject know?" still misses its expected chunk. That chunk ranks 9th by cosine and 3rd by BM25, behind chunks that arguably answer the question too (the chatbot's own LLM-as-judge layer, a code-model benchmark). The label may be too narrow rather than retrieval being wrong. A larger synthetic test set is where that gets settled.

### 7. Non-English questions are a separate problem

The chatbot replies in Spanish when asked in Spanish, but its retrieval is English-only. On the same 17 questions, hand-translated into natural Spanish:

| Question | Precision@4 | Recall@4 |
|---|---|---|
| English | 0.794 | 0.941 |
| Spanish, as asked | 0.446 | 0.588 |
| Spanish, translated to English **for retrieval only** (`m2m100`) | 0.863 | 1.000 |

What else was tried:
- **Hybrid search doesn't help Spanish:** Spanish words never match English chunks.
- **A multilingual embedding model (`bge-m3`)** lifted Spanish recall but cut English precision to 0.608, and would need a second index.
- **Translating the question for retrieval** (while still replying to the original) closes the gap at ~0.9 neurons per Spanish question.

It's measured and planned, but deferred: English came first.

## Reproduce it yourself

The method generalizes to any small RAG corpus:

1. **Label your eval questions** with the chunk(s) a correct retrieval should return.
2. **Rebuild production ranking offline:** the same embedding model, the same candidate cut, and your *actual* ranking function, imported.
3. **Embed queries the way production does** (usually one per call).
4. **Score every variant** with precision@k, MRR and Recall@k, and count cases better or worse, not just means.
5. **Ship the untuned version** unless a tuned one wins by more than one case's worth.
6. **Confirm on a production-identical preview** before trusting the offline numbers.
