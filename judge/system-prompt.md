# The judge system prompt

Verbatim, then the rationale for each clause. This is the prompt sent as the
`system` message on every judge call; the `user` message carries the
`QUESTION`, `BACKGROUND CONTEXT`, `ANSWER`, and — for hard cases — a
per-question `RUBRIC`.

## Verbatim

```
You are a strict evaluation judge for a portfolio chatbot that answers questions about one person, Victor Ramirez.
You are given the QUESTION a visitor asked, the BACKGROUND CONTEXT the chatbot retrieved for that question, and the ANSWER the chatbot gave.
Score the ANSWER on two dimensions, each an integer from 1 to 5:

relevance -- does the ANSWER address the QUESTION that was actually asked?
  1 = ignores the question or answers a different one; 3 = partially answers it; 5 = directly and completely answers it.

groundedness -- is every substantive factual claim in the ANSWER supported by the BACKGROUND CONTEXT?
  1 = key claims are absent from or contradicted by the context; 3 = partly supported; 5 = fully supported.
  If the BACKGROUND CONTEXT is empty, judge groundedness on general plausibility instead and say so in the rationale.
  If the ANSWER states specific employers, project names, tools, metrics, dates, or quantities that do NOT appear in the BACKGROUND CONTEXT, score groundedness 2 or lower -- even if the claim is plausible. Inventing verifiable specifics is worse than admitting the detail isn't available.

Do not reward length, confidence, or tone. A short answer that is correct outscores a long one that drifts. An answer that says 'I don't have that detail here' when the context genuinely lacks it is well-grounded, not a failure.
Respond with ONLY a JSON object, no prose and no code fences: {"relevance": <1-5>, "groundedness": <1-5>, "rationale": "<one sentence, max 600 chars>"}
```

When a hard case supplies a rubric, this is appended to the `user` message:

```
RUBRIC — a strong reply to this specific question: <expectedBehavior text>
Score against this rubric. A fluent answer that violates it (e.g. invents a fact the rubric says isn't available) should score low.
```

## Why each clause is there

**"strict evaluation judge … about one person"** — the judge needs to know the
domain is narrow and factual. Without "strict" the small model drifts toward
being generous; without the single-subject framing it doesn't treat an
invented employer as the error it is.

**Two dimensions, integers 1–5.** Relevance and groundedness fail
independently — a reply can nail the question and still fabricate, or be
perfectly grounded and answer the wrong question. Integers, not a 0–1 float,
because an 8B model gives you noise below that resolution anyway and a
5-point scale is what a human rater would use.

**"If the BACKGROUND CONTEXT is empty, judge groundedness on general
plausibility instead and say so."** Some questions retrieve nothing. Without
this line the judge scores those `groundedness: 1` mechanically, which
punishes correct deflections. *With* it, the judge falls back to plausibility
— which is itself a known weakness (a confident wrong answer is plausible),
and is exactly why the [training export](../training-export/filters.md) can't
trust the judge score alone on no-context rows.

**The invented-specifics clause** (score ≤2 for employers / projects / metrics
/ dates absent from context, "even if plausible"). Added *after* the
fine-tuning runs. The training-data export filters on the judge's relevance
score, and a confident, detailed, fabricated answer scores high on relevance.
The adapter trained on that data learned to always assert. This clause makes
the judge punish the exact failure mode the export was accidentally selecting
for — so the production eval now measures it directly.

**"Do not reward length, confidence, or tone."** LLM judges are biased toward
verbose, authoritative answers. This is the single most important line for
getting the judge to agree with a human. An answer that hedges correctly
should beat one that asserts incorrectly, and the default model behaviour is
the reverse.

**"An answer that says 'I don't have that detail here' … is well-grounded,
not a failure."** The counterweight to "strict." Deflection is the *correct*
output for an out-of-corpus question, and the judge has to score it as such
or every hard case collapses to "the model should have said more."

**"Respond with ONLY a JSON object, no prose and no code fences."** Small
models wrap JSON in prose and ` ```json ` fences constantly. The parser grabs
the first balanced `{...}` span as a fallback, but asking for clean output
first cuts the parse-failure rate substantially.

## Call parameters

| Parameter | Value | Why |
|---|---|---|
| model | a small instruction-tuned model (Llama 3.1 8B class) | ~10× cheaper per token than the reply model; the judge's output is two integers and a sentence |
| temperature | `0` | the same `(question, context, reply)` triple must score the same way run to run, so a score change means the *reply* changed |
| max tokens | `300` | the judge only ever emits `{relevance, groundedness, rationale}` |

The output is validated against a strict schema (`relevance` and
`groundedness` are integers 1–5, `rationale` is a non-empty string ≤600
chars). Anything that fails validation is recorded as "judge errored" for
that case and does **not** silently pass — and if *every* judge call in a run
errors, the whole run fails (a model deprecation or endpoint outage is an
infra failure, not a score of zero).
