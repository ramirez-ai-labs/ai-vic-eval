# A nightly scorecard

Representative of a real nightly run (Aug–Sep 2026). Per-case numbers are from
actual runs; the exact set on any given night varies because the 70B reply
model is non-deterministic (temperature 0.5), so every reply — and every
score — is fresh.

The point of the table is the **spread**. Before the hard cases and rubrics,
every row here was `5.0 / 5.0`. A suite that always returns full marks is
measuring nothing.

## Judged subset — 12 of 26 cases

| Case | relevance | groundedness | what the judge saw |
|---|---:|---:|---|
| `llm-eval-metrics` | 4.8 | 5.0 | direct, fully corpus-backed — Recall@k, MRR, groundedness, the two-layer split |
| `fine-tune-vs-rag` | 4.7 | 4.8 | on-topic, grounded; the corpus has a detailed answer to this one |
| `builder-vs-manager` | 4.6 | 4.4 | synthesises across the career arc; mild drift into generalities |
| `trustclaw` | 4.5 | 4.6 | project facts match the corpus (forked repo, Gmail webhook, Claude Haiku, Vercel, JFrog) |
| `management-experience` | 4.4 | 4.5 | grounded in the FAQ chunks |
| **`hard-synthesis-devops-to-ai`** | 4.6 | 4.1 | genuinely good — draws a specific through-line (readiness-gate discipline → LLM eval), not "both involve engineering" |
| **`hard-out-of-corpus-preference`** | 4.6 | 5.0 | deflected correctly — "no stated favorite; stack is Python-dominant, TypeScript, Rust" |
| **`hard-ambiguous-platform`** | 3.8 | 4.0 | answered the most likely referent but flagged the ambiguity — acceptable, not ideal |
| **`hard-absence-failures`** | 1.9 | 5.0 | **did not deflect** — stayed plausible so groundedness held, but answered a question it shouldn't have → relevance tanked |
| **`hard-precision-start-date`** | 1.9 | 2.7 | **fabricated a precise date** — the corpus has a year, the reply invented a day → lowest in the suite, correctly |
| **`hard-attention-vs-hidden-state`** | 3.0 | 1.0 | fluent, on-topic, and **not an answer** — missed parallelism and the O(n²) vs O(n) tradeoff entirely |
| **`hard-token-definition`** | 3.2 | 2.0 | defined token ≈ word (a factual error) and reached for an unverified cost metric |

**Run summary**

```
mean relevance     3.8      (advisory floor 3.0, blocking floor 3.5)
mean groundedness  3.9
range              1.9  ...  5.0
blocking?          no — both means above 3.5
warnings           hard-absence-failures (relevance 1.9)
                   hard-precision-start-date (relevance 1.9, groundedness 2.7)
                   hard-attention-vs-hidden-state (groundedness 1.0)
```

## How to read it

- **The softballs (top 5) sit in the 4.4–5.0 band.** That's the corpus doing
  its job — when there's a grounded answer, the model gives one.
- **The hard cases spread from 1.9 to 5.0.** `hard-synthesis-devops-to-ai`
  and `hard-out-of-corpus-preference` show the model *can* do the hard thing
  (synthesise; deflect). `hard-precision-start-date` and
  `hard-attention-vs-hidden-state` show where it still fails.
- **A regression looks like a softball dropping into the 3s**, or a hard case
  that was passing falling below its usual band. The blocking floor catches a
  broad collapse; the per-case warnings catch a single failure the mean would
  hide.
- **`groundedness 5.0` on `hard-absence-failures` with `relevance 1.9`** is
  the clearest single illustration of why two axes: the reply was
  *well-grounded nonsense* — it stayed plausible, so groundedness held, but
  it answered a question the corpus doesn't cover, so relevance collapsed. One
  number would have averaged that to a passing 3.5.
