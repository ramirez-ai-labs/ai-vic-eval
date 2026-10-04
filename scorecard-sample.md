# A nightly scorecard

Representative of real nightly runs (Aug–Sep 2026). Per-case numbers are from
actual runs; the exact set on any given night varies because the 70B reply
model is non-deterministic (temperature 0.5), so every reply — and every
score — is fresh.

The point of the table is the **spread**. Before the hard cases and rubrics,
every row here was `5.0 / 5.0`. A suite that always returns full marks is
measuring nothing.

## Judged subset — 16 of 31 cases

5 retrieval softballs (a baseline that should always score well) + all 11
`hard-*` cases. (That was the suite in September. It has since grown to 37
cases with 18 judged nightly — see [`hard-cases/`](hard-cases/README.md) for
the two newer cases.)

| Case | relevance | groundedness | what the judge saw |
|---|---:|---:|---|
| `llm-eval-metrics` | 4.8 | 5.0 | direct, fully corpus-backed — Recall@k, MRR, groundedness, the two-layer split |
| `fine-tune-vs-rag` | 4.7 | 4.8 | on-topic, grounded; the corpus has a detailed answer to this one |
| `builder-vs-manager` | 4.6 | 4.4 | synthesises across the subject's background; mild drift into generalities |
| `featured-project` | 4.5 | 4.6 | project facts match the corpus (repo, integrations, deployment count) |
| `management-experience` | 4.4 | 4.5 | grounded in the FAQ chunks |
| **`hard-synthesis-background`** | 4.6 | 4.1 | genuinely good — draws a specific through-line (release-gate discipline → LLM eval), not "both involve engineering" |
| **`hard-out-of-corpus-preference`** | 4.6 | 5.0 | deflected correctly — "no stated favorite; several languages, none ranked" |
| **`hard-ambiguous-platform`** | 3.8 | 4.0 | answered the most likely referent but flagged the ambiguity — acceptable, not ideal |
| **`hard-absence-failures`** | 1.9 | 5.0 | **did not deflect** — stayed plausible so groundedness held, but answered a question it shouldn't have → relevance tanked |
| **`hard-precision-start-date`** | 1.9 | 2.7 | **fabricated a precise date** — the corpus has a year, the reply invented a day → lowest in the suite, correctly |
| **`hard-attention-vs-hidden-state`** | 3.0 | 1.0 | fluent, on-topic, and **not an answer** — missed parallelism and the O(n²) vs O(n) tradeoff entirely |
| **`hard-token-definition`** | 3.2 | 2.0 | defined token ≈ word (a factual error) and reached for an unverified cost metric |
| **`hard-ungrounded-domain-fabrication`** | 4.6 | 5.0 | deflected on a zero-context technology question and offered the closest grounded work — the fix for the fabrication bug holding |
| **`hard-approach-monitoring`** | 4.2 | 4.6 | synthesised a real answer (continuous groundedness scoring, staged rollout, the chatbot's own eval) from adjacent context — did not refuse |
| **`hard-approach-model-lifecycle`** | 4.0 | 4.4 | answered from principles (readiness gates, eval-as-SDLC), noted it was the general approach |
| **`hard-approach-explainability`** | 4.3 | 4.7 | grounded and specific — auditability, cited-source-or-fail, RAG's visible failure mode |

**Run summary (a healthy run)**

```
mean relevance     4.0      (advisory floor 3.0, blocking floor 3.5)
mean groundedness  4.1
range              1.9  ...  5.0
blocking?          no — both means above 3.5
warnings           hard-absence-failures (relevance 1.9)
                   hard-precision-start-date (relevance 1.9, groundedness 2.7)
                   hard-attention-vs-hidden-state (groundedness 1.0)
```

## The run that caught a regression

A representative **failed** run — the nightly that caught the fabrication fix
over-correcting into refusal, before anyone reported it by hand:

```
mean relevance     3.2      ← below the 3.5 blocking floor → run FAILS
mean groundedness  3.7

fine-tune-vs-rag                 rel 3  ground 1   "asked the visitor to be more specific"  ← a SOFTBALL deflected
named-project                   rel 3  ground 5   "offered to discuss it, gave no project detail"  ← a SOFTBALL deflected
hard-synthesis-background       rel 3  ground 1   "offered to share, drew no through-line"
hard-ambiguous-platform         rel 3  ground 5   "offered to share, didn't clarify which platform"
hard-attention-vs-hidden-state  rel 3  ground 1   "asked the visitor to ask about the subject's projects"
hard-token-definition           rel 3  ground 1   "shifted focus to the subject's experience"
```

The tell is the **softballs dropping into the 3s**. When `named-project` — a
question about one of the subject's projects, with a full, grounded corpus answer — scores relevance 3 because the
reply deflected, something in the model or the prompt broke. The per-case
warnings would have caught a single hard case slipping; the mean going under
the floor is what catches a broad behavioural shift like this one.

## How to read it

- **The softballs (top 5) sit in the 4.4–5.0 band** on a healthy run. That's
  the corpus doing its job — when there's a grounded answer, the model gives
  one. On the regression run they collapsed to 3s.
- **The hard cases spread from ~1.9 to ~5.0.** `hard-synthesis-background`,
  `hard-out-of-corpus-preference`, and the `hard-approach-*` cases show the
  model *can* do the hard thing (synthesise; deflect; answer from
  principles). `hard-precision-start-date` and `hard-attention-vs-hidden-state`
  show where it still fails.
- **A regression looks like a softball dropping into the 3s**, or a hard case
  that was passing falling below its usual band. The blocking floor catches a
  broad collapse; the per-case warnings catch a single failure the mean would
  hide.
- **`groundedness 5.0` on `hard-absence-failures` with `relevance 1.9`** is
  the clearest single illustration of why two axes: the reply was
  *well-grounded nonsense* — it stayed plausible, so groundedness held, but
  it answered a question the corpus doesn't cover, so relevance collapsed. One
  number would have averaged that to a passing 3.5.
- **`hard-ungrounded-domain-fabrication` vs `hard-approach-*`** is the other
  pair worth watching together: the first should deflect, the second three
  should not. If the first climbs while the others drop, the model is
  over-deflecting; the reverse means it's fabricating again.
