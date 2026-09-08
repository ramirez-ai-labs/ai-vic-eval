# I fine-tuned a model for my portfolio chatbot. My own eval told me not to ship it.

AI-Vic is the chatbot on my portfolio site. It answers questions about my
work, grounded in a RAG corpus, running on a free-tier Cloudflare Worker.
The most recent build phase (4A) added an LLM-as-judge evaluation layer. The
next one (4B) was going to use that layer's output to fine-tune a small model
— "built and evaluated my own LLM" is a strong portfolio signal, and a 7B
model with an adapter is roughly 10× cheaper to run than the 70B behind
AI-Vic today.

I built the training pipeline, ran the fine-tune across two base models, and
A/B tested every adapter against the un-adapted base with the same judge that
scores production traffic. **The adapter regressed on every run.** The base
model plus retrieval plus a well-written system prompt was already better. So
I didn't ship it.

The interesting part isn't the adapter. It's that the evaluation framework
caught its own blind spot, then caught the fine-tune, and I had the numbers to
make the call instead of shipping on vibes.

## Phase 4A: the judge that scored everything 5/5

The eval already had a keyword-and-retrieval check — Recall@4 for retrieval,
literal keyword matching for "groundedness." That catches gross regressions
and nothing subtle. A reply can contain every expected keyword and still be
evasive, padded, or quietly making things up.

So I added an LLM-as-judge: a small model reads the question, the retrieved
context, and the reply, and scores relevance and groundedness 1–5. It runs
nightly against a fixed case suite, and on every visitor thumbs-up/down.

The judge is deliberately an 8B model (Llama 3.1 class), *not* the 70B that
writes the replies. Reusing the reply model would roughly double the cost of
every eval run — and let the model grade its own homework.

For two weeks it returned **5/5 on almost everything.** Not because the
replies were perfect — because every case in the suite was a softball with
solid corpus backing. The judge *could* discriminate; I just wasn't asking it
anything hard.

## Fixing the judge: hard cases and per-question rubrics

Two changes turned it from a formality into a measurement.

**Hard cases.** I added out-of-corpus questions where a fluent, confident
answer is the *wrong* answer: "What's my favorite programming language?" (the
corpus states none — naming one is a groundedness failure), "What exact date
did I start my current job?" (the corpus gives a year, not a day), "What are
my biggest professional failures?" (not something the corpus covers — the
right move is a graceful redirect, not an invented list).

**Per-question rubrics.** Each hard case carries an `expectedBehavior` string
describing what a strong reply does. That gets appended to the judge prompt,
so a fluent answer that violates it scores low. On a preview run, the
favorite-language question went from 5/5 (no rubric) to groundedness 3/5
(with the rubric telling the judge that naming a favorite is fabrication).

After that, the nightly scores spread out — mean relevance in the 4.5s
instead of a flat 5.0, and per hard case:

| Case | relevance / groundedness |
|---|---|
| exact start date (fabricated a precise date) | 1.9 / 2.7 |
| biggest failures (didn't deflect) | 1.9 / 5.0 |
| transformer attention vs. RNN hidden state (shallow) | 3 / 1 |
| background synthesis (genuinely good) | 4.6 / 4.1 |
| out-of-corpus preference (deflected correctly) | 4.6 / 5.0 |

A 1.9-to-5.0 range on the same suite is the whole point. The judge now tells
me something.

## The training pipeline, and the filters it needed

The judge writes every score to a time-series table with the
`(question, context, reply)` triple. Phase 4B's export pulls the rows where
the judge rated both axes ≥4 and retrieved context was present, and turns
them into `(instruction, context, output)` training examples.

That naive query produces garbage. What it took to get a clean dataset:

- **Leaked tool-reasoning.** The 70B model sometimes opens a reply by
  narrating its own decision not to call a tool — "I don't have a function
  call for this prompt…" — which the judge scored fine (on-topic, grounded)
  but which is internal plumbing a visitor should never see. Filter: reject
  any row where the reply matches that pattern.
- **Tool-grounded answers.** When a reply's real grounding came from a live
  tool call (latest podcast episode, recent GitHub activity) rather than
  retrieval, the stored context doesn't contain the fact. Training on that
  pairs a context that doesn't support the answer with an output that states
  it — which teaches the model to assert facts from nothing. Filter: a new
  column recording which tools produced each reply; exclude rows where any
  did.
- **The human veto that wasn't wired in.** A visitor thumbs-down was
  recorded, judged, and then *ignored* by the export — which only checked the
  judge's score. I found live examples where the judge scored a
  human-rejected reply 5/5 (it falls back to "general plausibility" when no
  context was retrieved, and a confident wrong answer is plausible). Across
  the feedback data, **four of six thumbs-down replies scored ≥4/≥4 from the
  judge.** Filter: exclude any row a human rated unhelpful, regardless of the
  judge.
- **Duplicates.** The nightly suite re-asks the same ~12 questions every
  night, and each high-scoring reply landed as a separate row. One export had
  31 near-duplicate rows collapse to a handful of distinct questions. Filter:
  dedup by instruction, keeping the highest-scoring reply.

Even after all four filters, the surviving rows skewed ~90% "confident
first-person assertion with specifics" — the export selects on the judge's
relevance score, and a direct, detailed answer scores higher than a correct
hedge. So the export also appends ~18 hand-written pairs pointing the other
way: thin-context questions (salary, "write me a script", work not in the
corpus) paired with a graceful "I don't have that." Hand-authored, so they
bypass the row filters. It teaches the model *when not to assert* — and, as
the runs below show, it wasn't enough at this data scale.

Two weeks of organic traffic plus a deliberate question-asking exercise grew
the judge-approved pool to **65 clean, deduplicated examples** (from a first
export of 14), drawn from **~80 distinct questions asked**. With the ~18
hand-authored deflection pairs, the training set was **~83 examples**.

## The fine-tuning runs

LoRA — **Low-Rank Adaptation**: freeze the base model, train a small set of
new weights (a fraction of a percent of the total) that get added on top. The
adapter is ~16 MB. It trains free on a Colab T4 in about 13 minutes. The
design bet: don't fine-tune *knowledge* into the model, fine-tune *voice and
structure*, and let RAG stay the source of truth for facts.

**Run 1 — Llama-2-7b-chat, rank 16.** The adapter fabricated with confidence:
it claimed credit for building a well-known commercial model, and reframed a
small personal demo as an enterprise system built for a client that doesn't
exist.

**Run 2 — Llama-2-7b-chat, rank 8.** Lower rank, fewer epochs, cleaner data.
Still fabricating — an invented tech stack for a real project, several
invented failure stories, a "company-wide migration" that never happened.

**Run 3 — Qwen2.5-7B-Instruct, rank 8.** Switched to a 2024 base that follows
retrieved context far better than 2023-era Llama-2. The real projects in the
corpus came out *accurate* — matching repos, integrations, deployment counts.
But on questions the corpus doesn't cover, the adapter still invented: prior
employers I've never worked for, and a large-scale real-time data system that
doesn't exist.

The judge on that run — the same judge, running pairwise base-vs-tuned on
held-out questions:

```
         relevance  groundedness
base          4.57      5.00
tuned         4.43      4.71   ← regressed on both axes
```

FAIL, on the fine-tuning notebook's own A/B gate (tuned must beat base on
both axes) — a separate check from the production CI floor.

## The diagnosis: the training signal was the problem

The base model (Qwen + my system prompt + retrieval) was consistently *more
honest* than the adapter. Asked about a technology the corpus doesn't
mention, the base said "not explicitly mentioned in the portfolio, but I can
discuss it generally." The adapter claimed extensive hands-on production use
with specific throughput numbers. Same context, and the adapter ignored it.

The training data was ~90% "confident first-person assertion with specifics" —
because the export filter selects on the judge's *relevance* score, and a
direct, detailed answer scores higher on relevance than a hedge. So the
adapter learned exactly one thing: always assert. It applied that to every
question, including the ones where the honest answer is "I don't have that
here."

SFT can only show good answers. It structurally cannot teach "don't do X."
That's a preference problem, and SFT is the wrong tool for it.

## The decision

Ship Qwen2.5-7B base + retrieval + the existing system prompt. Don't deploy
the adapter. `VHRamirez/victor-ramirez-7b-lora` v0.4.0 stays on Hugging Face
as the artifact — the negative result is documented, not hidden.

Two mitigations did ship, because they improve the production eval regardless
of the adapter: the judge now scores an answer's groundedness ≤2 when it
states employers, project names, metrics, or dates absent from the context —
and explicitly treats an honest "I don't have that detail here" as
well-grounded, not a failure.

## What's next, if I revisit this

**DPO — Direct Preference Optimization.** Unlike SFT, it trains on
`(instruction, chosen, rejected)` triples — it can learn "prefer the grounded
answer over the confident-wrong one." And I have a reliable generator for the
rejected examples: run the model context-free and it fabricates every time.
`chosen` is the grounded reply or a deflection; `rejected` is the model's own
context-free hallucination. The book-standard budget for a narrow behavioral
target like "stop fabricating" is 200–500 pairs. That's a real project — a
new training notebook, careful hyperparameters (DPO drifts toward verbosity,
so a high `beta` to stay near the reference model) — not a weekend.

I'd only do it if the base-only version shows a real, costed gap in
production. Right now it doesn't.

## Takeaways

1. **An eval you never stress-test will tell you everything is fine.** Mine
   returned 5/5 for two weeks. Hard cases and per-question rubrics are what
   made it useful.
2. **The training data is the model.** Three runs, two base models, every
   hyperparameter I tried — none of it mattered, because the signal itself
   taught the wrong behavior.
3. **LLM judges are biased toward confident, verbose answers.** A fabricated
   reply that sounds authoritative will score well unless you specifically
   tell the judge to punish invented specifics.
4. **The strongest outcome of a fine-tuning project can be not shipping the
   fine-tune** — if you have the evaluation to know why. Reliability by
   default; impressiveness by choice.
