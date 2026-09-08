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

## Why an eval layer at all

The chatbot's first eval was a keyword-and-retrieval check — Recall@4 for
retrieval, literal keyword matching for "groundedness." That catches gross
regressions and nothing subtle. A reply can contain every expected keyword
and still be evasive, padded, or quietly making things up.

The LLM-as-judge is the second, softer signal on top: a small model reads the
question, the same retrieved context the chatbot was given, and the reply,
then scores **relevance** and **groundedness** 1–5. Deliberately a small
model (Llama 3.1 8B), not the 70B that writes the replies — reusing the reply
model roughly doubles the cost of every eval run and invites the model to
grade its own homework.

For two weeks it returned **5/5 on almost everything** — not because the
replies were perfect, but because every case in the suite was a softball with
solid corpus backing. Fixing that is most of what this repo documents.

## Contents

| Path | What |
|---|---|
| [`judge/system-prompt.md`](judge/system-prompt.md) | The judge's system prompt, verbatim, with the rationale for every clause |
| [`judge/scoring.md`](judge/scoring.md) | The two dimensions, the small-model choice, the exact-match score cache, why it's keyed on `(query, reply)` |
| [`hard-cases/README.md`](hard-cases/README.md) | The 7 `hard-*` cases — out-of-corpus questions where a fluent confident answer is the *wrong* answer — each with its per-question rubric and the failure it caught |
| [`training-export/filters.md`](training-export/filters.md) | The four filters that turn judge-approved rows into a clean fine-tuning set, and why a naive "score ≥ 4" query produces garbage |
| [`scorecard-sample.md`](scorecard-sample.md) | A representative nightly scorecard — the 1.9-to-4.6 spread that means the judge is measuring something |
| [`writeup.md`](writeup.md) | **"I fine-tuned a model for my portfolio chatbot. My own eval told me not to ship it."** The full negative-result narrative |

## The one-paragraph version of the write-up

Phase 4B was going to fine-tune a small LoRA adapter on the judge's
high-scoring output — "built and evaluated my own LLM" is a strong portfolio
signal, and a 7B + adapter is ~10× cheaper to run than a 70B. The adapter
regressed against the un-adapted base on every run, across two base models.
Root cause: the judge rewards direct, confident answers, so the high-scoring
training pool skewed ~90% "confident first-person assertion" — and SFT on
that teaches the model to *always* assert, so it fabricated specifics on
questions the corpus doesn't cover. The base model + retrieval + a
well-written system prompt was already better. So it wasn't shipped. The
adapter stays on Hugging Face
([`VHRamirez/victor-ramirez-7b-lora`](https://huggingface.co/VHRamirez/victor-ramirez-7b-lora))
as the documented artifact of the experiment.

## Related

- [rag-evaluation-lab](https://github.com/ramirez-ai-labs/rag-evaluation-lab) — a beginner-friendly walk through retrieval metrics (Recall@k, Precision@k, MRR)
- [Medium: RAG Evaluation series](https://medium.com/@vhr1975) — Fundamentals Without the Cloud → embedding-quality benchmarks → the retriever decision framework

## License

MIT — see [LICENSE](LICENSE).
