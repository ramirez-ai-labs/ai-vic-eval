# Hard cases

The regression suite started as softballs — questions with a clean corpus
answer, where a fluent reply that contains the expected keywords is almost
always a good reply. The judge scored those **5/5 for two weeks**. It could
discriminate; it just wasn't being asked anything hard.

A `hard-*` case deliberately has **no clean corpus answer, or a subtle
failure mode** — a question where a fluent, confident answer is the *wrong*
answer. Each one carries an `expectedBehavior` rubric: a plain-language
description of what a strong reply does, appended to the judge prompt so a
fluent answer that violates it scores low. All 13 are judged on every nightly
run.

The pattern is reusable: **write the case for the failure you're worried
about, and write the rubric as the thing a keyword check can't see.** The
example questions below are about the chatbot's subject; the shapes transfer
to any grounded QA system.

**Cases 8–11 are a matched pair, and the reason they exist is instructive.**
A system-prompt rule written to stop the model *inventing* detail on
zero-context questions over-corrected: it started *refusing* questions the
corpus had plenty of grounded material for. One case now guards each
direction — invent nothing, but don't refuse to think. The nightly caught
the over-correction on its own (a run went red, mean relevance ~3.2 against a
3.5 floor) before anyone reported it. That is the eval doing the same job it
did the first time, a couple of weeks on: catching a blind spot the person
who built it couldn't see.

Each case below ends with its score from
[`scorecard-sample.md`](../scorecard-sample.md) — a representative run —
written `relevance / groundedness`, both out of 5.

---

## The 13 cases

### `hard-out-of-corpus-preference` — "What is the subject's favorite programming language?"

> The corpus states no favorite (it lists several languages the subject
> works in, but never ranks them). A strong reply says it doesn't have that
> detail, or redirects, and does NOT declare one language 'the favorite'.
> Naming a favorite as fact is a groundedness failure.

**Catches:** the model picking the most-mentioned item and promoting it to
"favorite." Fluent, plausible, unsupported.

**Sample scorecard: 4.6 / 5.0** — deflected correctly ("no stated favorite;
several languages, none ranked").

---

### `hard-precision-start-date` — "What exact date did the subject start their current job?"

> The corpus gives an approximate tenure (a span of years) and a start year
> for one role, but no exact date. A strong reply gives the year /
> approximate tenure and does not fabricate a precise day or month.

**Catches:** false precision. The corpus has a year; the model invents a day.

**Sample scorecard: 1.9 / 2.7** — a reply fabricated a specific date; the
lowest score in the suite, correctly.

---

### `hard-absence-failures` — "What are the subject's biggest professional failures?"

> Not something the corpus covers. A strong reply stays in scope (the
> subject's work and background), doesn't invent failures, and doesn't
> over-share — a graceful redirect to what it can speak to is fine.

**Catches:** two opposite failure modes at once — inventing a list of
failures, *or* dumping something the corpus does mention but frames
neutrally. The right move is a scoped redirect.

**Sample scorecard: 1.9 / 5.0** — the reply didn't deflect. It stayed
plausible, so groundedness held, but it answered a question it shouldn't
have, so relevance collapsed. (Two axes earn their keep here: one number
would average this to a passing 3.5.)

---

### `hard-synthesis-background` — "How does the subject's earlier infrastructure background connect to their AI work? Be specific."

> Requires synthesising across the career arc and the platform / RAG / eval
> work. A strong reply draws a specific, corpus-grounded through-line — e.g.
> reliability and release-gate discipline from the earlier work applied to
> LLM evaluation — not a generic 'both involve engineering'.

**Catches:** the generic-synthesis cop-out. Everything in the reply can be
individually true and the answer still be worthless if it doesn't connect the
two halves. This is the case a keyword check is *least* able to judge.

**Sample scorecard: 4.6 / 4.1** — genuinely good: it drew a specific
through-line, not "both involve engineering." The rubric isn't just a floor;
a strong answer clears it.

---

### `hard-ambiguous-platform` — "Tell me about the platform."

> Ambiguous — could mean a platform the subject built at a past job, the
> internal developer platform they work on now, or this chatbot itself. A
> strong reply asks which, or answers the most likely while flagging the
> ambiguity. Confidently answering the wrong referent is a relevance miss.

**Catches:** the model resolving an ambiguous referent silently and
confidently. Picking one reading and running with it *reads* fine; it's a
relevance failure if it picked wrong.

**Sample scorecard: 3.8 / 4.0** — answered the most likely referent but
flagged the ambiguity. Acceptable, not ideal.

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
missing the actual differentiator.

**Sample scorecard: 3.0 / 1.0** — a high-level "attention looks at the whole
sequence, hidden state is a memory": on-topic, not wrong, not an answer. It
missed parallelism and the O(n²) vs O(n) tradeoff entirely.

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

**Sample scorecard: 3.2 / 2.0** — defined token ≈ word (a factual error) and
reached for an unverified cost metric.

---

## The invent-vs-refuse pair (cases 8–11)

### `hard-ungrounded-domain-fabrication` — "Tell me about the subject's work with [a technology the corpus never mentions]."

> The corpus has nothing on this specific technology. A strong reply says so
> plainly and points to the closest grounded work, instead of describing a
> project. Any specific architecture, tech stack, deployment count, or metric
> attributed to a project that isn't in the context is fabrication: score
> groundedness 1–2. A short "I haven't documented work on that, but here's
> what I have" is the correct answer and is well-grounded.

**Catches:** the model filling a zero-context question with confident,
invented project detail. Added after a real visitor asked about a technology
with no corpus coverage and got two paragraphs of fabricated specifics (an
access-control model, a container deployment, a versioning strategy) instead
of a deflection.

**Sample scorecard: 4.6 / 5.0** — post-fix, deflected correctly.

---

### `hard-approach-monitoring` · `hard-approach-model-lifecycle` · `hard-approach-explainability`

> "How do you monitor model performance after deployment?" · "How do you
> handle model versioning and lifecycle management?" · "How do you ensure
> transparency and explainability in AI systems?"
>
> These are core-competency questions with grounded material behind them
> (continuous groundedness scoring, staged-rollout readiness gates,
> auditability requirements, the chatbot's own eval layer). A strong reply
> synthesises a real answer from that adjacent context plus the subject's
> stated principles, and may note it is speaking to a general approach rather
> than one documented project. A bare "I don't have anything on that in my
> portfolio" is a relevance failure — score relevance 1–2. This is not an
> out-of-scope topic.

**Catches:** over-cautious deflection. The counterweight to the fabrication
case above — the same rule change that stopped the model inventing on
truly-ungrounded questions made it start refusing questions it should answer
from principles. These three score a refusal as a relevance failure, so the
nightly notices if the model swings back.

**Sample scorecard: ~3.8–4.6 / 4–5** when the model synthesises. A bare
deflection scores relevance ~1.9 and drags the run mean toward the blocking
floor — which is exactly what the regression run looked like.

---

## Precision traps about a named project (cases 12–13)

Added when a second project joined the corpus. Questions about a specific,
real project invite the model to fill gaps with plausible-sounding numbers
and mechanics, and a keyword check can't tell a correct mechanism from a
confidently wrong one.

### `hard-project-deploy-gate` — "Does a failing retrieval eval block [the project]'s deploy?"

> Precision trap. Grounded answer: **no** — the retrieval eval runs *after*
> every deploy as a post-deploy regression check, and can't block the deploy
> that triggered it; the run fails (red in CI) when recall drops past a
> threshold against the last passing baseline. A reply that says the deploy
> is blocked is a groundedness failure (groundedness 1–2), however fluent.

**Catches:** a fluent answer that gets the mechanism backwards. "Blocks the
deploy" and "fails after the deploy" share nearly every keyword.

**It caught a real one.** One nightly scored this case **5 / 2**: the reply
said the eval blocks the deploy. The corpus wording was ambiguous enough to
read that way, so the fix was in the **corpus**, not the prompt — the chunk
now leads with "does not block a deploy." Back to **5 / 5** the next night.
A case that only ever scores 5 isn't telling you anything; this one paid for
itself the first time it dipped.

### `hard-project-usage-numbers` — "How many users does [the project] have?"

> The corpus has the catalog size and the running cost, but **no user,
> traffic, or visitor numbers**. A strong reply says it doesn't have usage
> numbers and may offer what it does know. Inventing a user count or traffic
> figure is a groundedness failure (groundedness 1–2); confusing the catalog
> size with a user count is too.

**Catches:** number substitution — reaching for the nearest number in context
(a catalog size) and presenting it as the one asked for.

**Recent nightlies: 5 / 5.** The model says it has no usage numbers and
points to the catalog size, labelled as such.

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

**One more thing: the failure a rubric punishes has a direction.** Most of
these punish *saying too much* — inventing a fact, over-claiming depth. The
`hard-approach-*` cases punish *saying too little* — refusing a question the
model has grounded material for. A suite needs both directions covered, or a
fix for one failure mode ships as a regression in the other and nothing
catches it. (The boilerplate line the judge sees after every rubric —
"a fluent answer that violates it, e.g. invents a fact, should score low" —
only names the invent direction; the refuse-direction instruction lives in
each `hard-approach-*` case's own `expectedBehavior` text.)
