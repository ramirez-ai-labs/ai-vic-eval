# ai-vic-eval

The evaluation methodology behind **AI-Vic**, the chatbot on
[ramirezailabs.com](https://ramirezailabs.com) — an LLM-as-judge layer that
runs nightly and on every visitor thumbs-up/down, plus the negative-result
write-up of the fine-tuning experiment it was built to feed.

This repo is the **methodology**, not the chatbot. The chatbot itself is a
private repo (a Cloudflare Worker doing RAG + agentic tool-calling over a
hand-written corpus about one person). What's public here is the part that
generalises: how the judge is prompted, how the hard cases are written, how
the training-data export is filtered, and what happened when a fine-tune was
trained on that data.

**Assumed background:** you know roughly what RAG and fine-tuning are. If the
retrieval-metrics basics (Recall@k, MRR) are new, start with
[rag-evaluation-lab](https://github.com/ramirez-ai-labs/rag-evaluation-lab)
first, then come back. Every acronym used here is spelled out in
[Terms](#terms) at the bottom.

## Why an eval layer at all

The chatbot's first eval was a keyword-and-retrieval check — Recall@4 for
retrieval, literal keyword matching for "groundedness." That catches gross
regressions and nothing subtle. A reply can contain every expected keyword
and still be evasive, padded, or quietly making things up.

The LLM-as-judge is the second, softer signal on top: a small model reads the
question, the same retrieved context the chatbot was given, and the reply,
then scores **relevance** and **groundedness** 1–5. Deliberately a small
model (Llama 3.1 8B class), not the 70B that writes the replies — reusing the
reply model roughly doubles the cost of every eval run and invites the model
to grade its own homework.

For two weeks it returned **5/5 on almost everything** — not because the
replies were perfect, but because every case in the suite was a softball with
solid corpus backing. Fixing that is most of what this repo documents.

## How the pieces fit together

```mermaid
flowchart TD
    V["Visitor question"] --> R["70B model writes a reply<br/>(RAG context + agentic tools)"]
    R --> U["Visitor sees the reply"]
    U -->|"thumbs up / down"| F["Human rating"]

    subgraph EVAL["The eval layer (this repo)"]
      N["Nightly: fixed case suite<br/>5 softballs + 7 hard cases"] --> J
      F --> J["8B judge scores relevance<br/>and groundedness 1-5<br/>(hard cases add a rubric)"]
      J --> S[("eval_scores<br/>append-only time series")]
      J -.->|"cache hit skips the call"| C[("judge_cache")]
      S --> G{"run means under<br/>the blocking floor?"}
      G -->|"yes"| FAIL["CI fails"]
      G -->|"no"| PASS["CI passes"]
    end

    S --> X["Phase 4B export:<br/>rows the judge scored high,<br/>with retrieved context"]
    X --> FT["4 filters + hand-authored<br/>deflection set"]
    F -.->|"a thumbs-down<br/>vetoes the row"| FT
    FT --> TR["training set (~83 examples)"]
    TR --> LORA["LoRA fine-tune<br/>(2 base models, 3 runs)"]
    LORA --> AB["pairwise A/B vs un-adapted base,<br/>same judge"]
    AB --> D["Decision: ship base + RAG,<br/>not the adapter"]
```

The [write-up](writeup.md) is the story of the bottom branch (the export and
everything below it). The rest of the repo documents the subgraph — **the
eval layer**.

## Contents

| Path | What |
|---|---|
| [`judge/system-prompt.md`](judge/system-prompt.md) | The judge's system prompt, verbatim, with the rationale for every clause |
| [`judge/scoring.md`](judge/scoring.md) | The two dimensions, the small-model choice, the exact-match score cache (and why it's keyed on `(query, reply)`), the append-only time series vs. the cache, and the CI blocking floor |
| [`hard-cases/README.md`](hard-cases/README.md) | The 7 `hard-*` cases — questions with no clean corpus answer, or a subtle failure mode, where a fluent confident answer is the *wrong* answer — each with its per-question rubric and the failure it caught |
| [`training-export/filters.md`](training-export/filters.md) | The four filters that turn judge-approved rows into a clean fine-tuning set, and why a naive "score ≥ 4" query produces garbage |
| [`scorecard-sample.md`](scorecard-sample.md) | A representative nightly scorecard — the 1.9-to-5.0 spread that means the judge is measuring something |
| [`writeup.md`](writeup.md) | **"I fine-tuned a model for my portfolio chatbot. My own eval told me not to ship it."** The full negative-result narrative |

**New here?** Read [`writeup.md`](writeup.md) first — it's the whole story
start to finish. Then [`judge/system-prompt.md`](judge/system-prompt.md) and
[`hard-cases/README.md`](hard-cases/README.md) for how the judge actually
works, and [`scorecard-sample.md`](scorecard-sample.md) to see it scoring.

## The one-paragraph version of the write-up

The fine-tuning phase (Phase 4B in the chatbot's internal roadmap — the eval
layer itself is Phase 4A) was going to fine-tune a small LoRA adapter on the
judge's high-scoring output — "built and evaluated my own LLM" is a strong
portfolio signal, and a 7B + adapter is ~10× cheaper to run than a 70B. The
adapter regressed against the un-adapted base on every run, across two base
models. Root cause: the judge rewards direct, confident answers, so the
high-scoring training pool skewed ~90% "confident first-person assertion" —
and supervised fine-tuning (SFT) on that teaches the model to *always*
assert, so it fabricated specifics on questions the corpus doesn't cover. The
base model + retrieval + a well-written system prompt was already better. So
it wasn't shipped. The adapter stays on Hugging Face
([`VHRamirez/victor-ramirez-7b-lora`](https://huggingface.co/VHRamirez/victor-ramirez-7b-lora))
as the documented artifact of the experiment.

## Terms

| Term | What it means here |
|---|---|
| **RAG** | Retrieval-Augmented Generation — before the model answers, a retriever pulls relevant chunks from the corpus and pastes them into the prompt as "background context." |
| **LLM-as-judge** | Using a second language model to score the first model's output, instead of a keyword or exact-match check. |
| **relevance / groundedness** | The judge's two axes. Relevance: does the answer address the question asked? Groundedness: is every factual claim supported by the retrieved context? |
| **Recall@k / MRR** | Retrieval metrics from the older eval layer. Recall@k: did the right chunk land in the top *k* results? MRR: mean reciprocal rank of the first relevant chunk. See [rag-evaluation-lab](https://github.com/ramirez-ai-labs/rag-evaluation-lab). |
| **SFT** | Supervised Fine-Tuning — training on `(prompt, good answer)` pairs. Can only demonstrate good answers; structurally can't teach "don't do X." |
| **LoRA** | Low-Rank Adaptation — freeze the base model, train a small set of add-on weights (here ~16 MB). Cheap to train and to serve. |
| **DPO** | Direct Preference Optimization — trains on `(prompt, chosen, rejected)` triples, so it *can* learn to prefer one behaviour over another. The proposed next step, not yet done. |
| **BPE** | Byte-Pair Encoding — a common tokenizer algorithm that splits text into sub-word units. |
| **the corpus** | The private, hand-written body of text about one person that the chatbot retrieves from. Not in this repo. |
| **the judge / the reply model** | The 8B model that scores (judge) vs the 70B model that writes visitor-facing answers (reply model). |

## Related

- [rag-evaluation-lab](https://github.com/ramirez-ai-labs/rag-evaluation-lab) — a beginner-friendly walk through retrieval metrics (Recall@k, Precision@k, MRR)
- [Medium: RAG Evaluation series](https://medium.com/@vhr1975) — Fundamentals Without the Cloud → embedding-quality benchmarks → the retriever decision framework

## License

MIT — see [LICENSE](LICENSE).
