# Hard cases

The regression suite started as softballs — questions with a clean corpus
answer, where a fluent reply that contains the expected keywords is almost
always a good reply. The judge scored those **5/5 for two weeks**. It could
discriminate; it just wasn't being asked anything hard.

A `hard-*` case deliberately has **no clean corpus answer, or a subtle
failure mode** — a question where a fluent, confident answer is the *wrong*
answer. Each one carries an `expectedBehavior` rubric: a plain-language
description of what a strong reply does, appended to the judge prompt so a
fluent answer that violates it scores low. All 7 are judged on every nightly
run.

The pattern is reusable: **write the case for the failure you're worried
about, and write the rubric as the thing a keyword check can't see.** The
example questions below are about the chatbot's subject; the shapes transfer
to any grounded QA system.

---

## The 7 cases

### `hard-out-of-corpus-preference` — "What is the subject's favorite programming language?"

> The corpus states no favorite (it lists several languages the subject
> works in, but never ranks them). A strong reply says it doesn't have that
> detail, or redirects, and does NOT declare one language 'the favorite'.
> Naming a favorite as fact is a groundedness failure.

**Catches:** the model picking the most-mentioned item and promoting it to
"favorite." Fluent, plausible, unsupported.

---

### `hard-precision-start-date` — "What exact date did the subject start their current job?"

> The corpus gives an approximate tenure (a span of years) and a start year
> for one role, but no exact date. A strong reply gives the year /
> approximate tenure and does not fabricate a precise day or month.

**Catches:** false precision. The corpus has a year; the model invents a day.
On one run a reply fabricated a specific date and scored **relevance 1.9 /
groundedness 2.7** — the lowest in the suite, correctly.

---

### `hard-absence-failures` — "What are the subject's biggest professional failures?"

> Not something the corpus covers. A strong reply stays in scope (the
> subject's work and background), doesn't invent failures, and doesn't
> over-share — a graceful redirect to what it can speak to is fine.

**Catches:** two opposite failure modes at once — inventing a list of
failures, *or* dumping something the corpus does mention but frames
neutrally. The right move is a scoped redirect. A reply that didn't deflect
scored **relevance 1.9**.

---

### `hard-synthesis-background` — "How does the subject's earlier infrastructure background connect to their AI work? Be specific."

> Requires synthesising across the career arc and the platform / RAG / eval
> work. A strong reply draws a specific, corpus-grounded through-line — e.g.
> reliability and release-gate discipline from the earlier work applied to
> LLM evaluation — not a generic 'both involve engineering'.

**Catches:** the generic-synthesis cop-out. Everything in the reply can be
individually true and the answer still be worthless if it doesn't connect the
two halves. This is the case a keyword check is *least* able to judge — and
when the reply is genuinely good it scores **~4.6 / 4.1**, so the rubric
isn't just a floor.

---

### `hard-ambiguous-platform` — "Tell me about the platform."

> Ambiguous — could mean a platform the subject built at a past job, the
> internal developer platform they work on now, or this chatbot itself. A
> strong reply asks which, or answers the most likely while flagging the
> ambiguity. Confidently answering the wrong referent is a relevance miss.

**Catches:** the model resolving an ambiguous referent silently and
confidently. Picking one reading and running with it *reads* fine; it's a
relevance failure if it picked wrong.

---

### `hard-attention-vs-hidden-state` — "What is the difference between a transformer's attention mechanism and a recurrent network's hidden state?"

> A strong reply names the actual mechanism difference: attention computes a
> weighted sum over all positions in parallel (query/key/value projections);
> recurrence carries information step-by-step through a hidden state. It
> should state the complexity tradeoff (attention is O(n²) in sequence length
> but parallelizes; recurrence is O(n) but sequential) and that this tradeoff
> is why transformers won. A reply that only describes what each is 'for' at
> a high level, without naming parallelism or the complexity tradeoff, is a
> groundedness/depth failure regardless of fluency.

**Catches:** fluent-but-shallow technical answers. Added after a live review
found the reply generator answering confidently on ML fundamentals while
missing the actual differentiator. A high-level "attention looks at the whole
sequence, hidden state is a memory" scored **3 / 1** — on-topic, not wrong,
not an answer.

---

### `hard-token-definition` — "What is a token, and why does it matter for cost?"

> A strong reply defines a token as a sub-word unit produced by a tokenizer
> (e.g. BPE/tiktoken), not a word or character — conflating token with word
> is a factual error. It should mention that models are billed per
> input/output token and give a concrete cost-risk framing. A reply
> inventing a specific unverified project or metric (e.g. a fabricated
> cost-reduction percentage) is a groundedness failure, not just a shallow
> one.

**Catches:** the token≈word error, *and* the model reaching for a fabricated
project metric to illustrate the cost point. Two different failure modes in
one question.

---

## How a rubric is written

Three things, every time:

1. **State the fact the corpus does / doesn't contain.** "The corpus states
   no favorite." "The corpus gives a year, not a day." This is what the judge
   checks groundedness against.
2. **Name the correct behaviour, including deflection as a valid answer.**
   "says it doesn't have that detail, or redirects." The judge defaults to
   penalising a short answer; the rubric tells it not to here.
3. **Name the specific failure mode to punish.** "Naming a favorite as fact
   is a groundedness failure." "Confidently answering the wrong referent is a
   relevance miss." This is the sentence that turns a 5/5 into a 3/5.

The rubric is the thing a keyword match can't see. If your check *can* be
expressed as "these words must appear," it's not a hard case — it's a normal
one.
