# Filtering judge-approved rows into a fine-tuning set

The judge writes every score to a time-series table with the
`(question, context, reply)` triple. The fine-tuning export pulls the rows
where the judge rated **both** relevance and groundedness ≥ 4 **and**
retrieved context was present, and turns them into `(instruction, context,
output)` training examples.

That naive query produces garbage. Four filters, each logged with a count, in
mutually-exclusive order so the dropped totals add up and a row is blamed on
exactly one thing.

---

## 1. Leaked tool-reasoning

The 70B reply model sometimes opens a reply by narrating its own decision
*not* to call a tool — "I don't have a function call for this prompt…" — which
the judge scored fine (on-topic, grounded) but which is internal plumbing a
visitor should never see.

**Filter:** reject any row whose reply matches `/\b(function call|tool
call)s?\b/i`.

This is a second line of defense on top of the system-prompt and agent-layer
fix that stopped the model doing it going forward — rows logged *before* that
fix shipped are still in the table and would still teach the adapter to talk
this way.

---

## 2. Tool-grounded answers

When a reply's real grounding came from a live tool call (latest podcast
episode, recent GitHub activity) rather than retrieval, the stored context
**doesn't contain the fact.** Training on that row pairs a context that
doesn't support the answer with an output that states it — which teaches the
model to assert facts from nothing. On a fresh question about the same topic
the adapter then produces a plausible-sounding wrong answer.

**Filter:** a column records which tools produced each reply; exclude rows
where any did.

Caveat: that column is only populated going forward. Rows from before it
existed stay null and pass this filter even if a tool produced them —
unrecoverable after the fact.

---

## 3. The human veto that wasn't wired in

A visitor thumbs-down was recorded, judged, and then **ignored by the export**
— which only checked the judge's score. There were live examples where the
judge scored a human-rejected reply 5/5: it falls back to "general
plausibility" when no context was retrieved, and a confident wrong answer is
plausible. Across the feedback data, **four of six 👎 replies scored ≥4/≥4
from the judge.**

**Filter:** exclude any row a human rated unhelpful, regardless of the judge's
score.

The human veto has to sit *on top of* the judge score, not be one input to
it. This is the filter that most changed the output quality — and it's a
one-line check that was simply missing from the first version.

---

## 4. Duplicates

The nightly suite re-asks the same ~12 questions every night, and each
high-scoring reply landed as a separate row. One export had 31 near-duplicate
rows collapse to a handful of distinct questions — which makes a held-out
split look like memorisation instead of generalisation.

**Filter:** dedup by normalised instruction, keeping the single
highest-scoring reply per question.

---

## The counterweight: a hand-authored deflection set

Even after all four filters, the surviving rows skew **~90% "confident
first-person assertion with specifics"** — because the export filters on the
judge's *relevance* score, and a direct, detailed answer scores higher on
relevance than a correct hedge. An adapter trained on that alone learns
exactly one thing: always assert.

So the export appends ~18 hand-written `(thin-context question → graceful "I
don't have that" answer)` pairs — digital-twin questions, salary questions,
"write me a script" requests, questions about work that isn't in the corpus.
Hand-authored, so they bypass the row filters above. This teaches the model
*when not to assert*.

It wasn't enough. See [the write-up](../writeup.md) — at this data scale
(~65 judged + 18 deflection ≈ 80 examples) the imbalance still won, and the
adapter fabricated on out-of-corpus questions. But the deflection-set idea is
sound; the problem was volume.

---

## What a clean training example looks like

```json
{
  "instruction": "<the visitor's question>",
  "context": "<the retrieved background block the model was given>",
  "output": "<the judged-good reply>",
  "metadata": {
    "relevance_score": 5,
    "groundedness_score": 4,
    "mean_score": 4.5,
    "judge_model": "<the 8B judge>",
    "created_at": "<ISO timestamp>"
  }
}
```

Two weeks of organic traffic plus a deliberate question-asking exercise grew
the clean, deduplicated set from **14 examples to 65**, across ~80 distinct
grounded questions. Per *LLM Engineering* (Packt), that's below the floor a
7B model needs — the LIMA "1,000 samples" figure is for 70B models; a 7B
needs more just to learn the chat template, and task-specific fine-tuning
wants 100–100,000.
