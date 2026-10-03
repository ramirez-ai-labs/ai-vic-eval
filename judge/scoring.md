# Scoring: the model choice, the cache, the time series

## Why a small judge model

A judge call using the same 70B model that writes the replies would roughly
**double the generation cost of every eval run** — and on a free-tier neuron
budget that matters. An 8B instruction-tuned model is about an order of
magnitude cheaper per token, and a judge call's output is tiny: two integers
and one sentence. The quality cost is real but bounded, and the hard-case
rubrics (see [`../hard-cases/`](../hard-cases/README.md)) do most of the work
of keeping the small model honest.

It also runs through the same AI gateway as every other model call, so its
usage shows up on the same dashboard and isn't a blind spot.

## The two triggers

1. **Nightly** — a fixed subset of the regression suite (currently 18 of 34
   cases: 5 retrieval softballs + all 13 `hard-*` cases) is judged on a
   schedule. Up to 18 small model calls a night, fewer when the score cache
   hits.
2. **Live feedback** — every time a visitor rates a reply 👍/👎, that
   `(query, reply)` is judged in the background and the score is stored next
   to the human rating. This builds a labelled set: *does the machine agree
   with the human?*

On the real feedback data the answer is "usually, not always" — a meaningful
fraction of 👍 replies get a ≤3 from the judge (it catches thin or invented
answers the visitor liked anyway), and a **majority of 👎 replies score ≥4**
from the judge (the human catches confident, on-topic, subtly-wrong answers
the judge is blind to). Both signals are load-bearing; neither alone is
enough. This is why the training export applies the [👎 as a hard
veto](../training-export/filters.md#3-the-human-veto-that-wasnt-wired-in),
not as one input to a score.

## The exact-match score cache

Judge scores are cached, keyed on a SHA-256 of **both** the query and the
reply (with byte-lengths prefixed so `("ab","c")` and `("a","bc")` can't
collide). On a cache hit: no model call, no retrieval, reuse the stored
score.

**Keyed on `(query, reply)`, not `query` alone**, on purpose. An earlier
design keyed on the query only. For an FAQ cache that's fine. For an **eval**
it's a correctness bug: change a reply, and the eval serves you the *old*
reply's score — a regression hides behind a stale cache entry. The whole
point of the eval is to notice when the reply changed.

Where the cache actually helps:

- **Live feedback: yes.** The same rated answer scored twice — e.g. the
  nightly and a visitor 👍 landing on an identical reply — is a hit.
- **The nightly: no.** The 70B reply model runs at temperature 0.5, so the
  reply text (and the cache key) changes run to run. Observed nightly hit
  rate: **0%**. That's fine — ~16 tiny 8B calls a night is negligible — but
  the cache was designed assuming a reply stability that doesn't hold, and
  it's worth being honest that it earns its keep on feedback, not on the
  schedule.

A corpus, prompt, or reply change is always a miss — exactly when you want a
fresh score. A `skipCache` flag forces one regardless (used when the *judge*
prompt itself changes and every cached score needs redoing).

## The time series vs. the cache

Two separate stores:

- **`eval_scores`** — append-only, **one row per judge run**, including cache
  hits. Carries the git SHA, the case id, and the full
  `(query, context, reply)` triple. This is the trend history — a query over
  it never has gaps.
- **`judge_cache`** — one row per distinct `(query, reply)`, with a hit
  count. This is the cost optimisation, not the history.

The `context` column on `eval_scores` — the retrieved background block the
judge saw — is populated on a cache miss (a hit skips retrieval). That gave
the fine-tuning phase full `(instruction, context, output)` triples to
export.

## The blocking floor

The judge means gate CI: a run **fails** below a blocking minimum (3.5) and
**warns** below an advisory minimum (3.0). The floor was wired only once the
hard-case spread proved stable over several nightly runs — set conservatively
to avoid noisy failures while the signal-to-noise was still improving.

The floor has fired on a real regression since. A system-prompt change meant
to curb fabrication made the reply model over-deflect — it started refusing
in-scope questions — and the nightly mean dropped to ~3.2, failing the run.
The failure landed a day or two before the same behaviour got reported by
hand, which is the point of running it nightly. The gap the incident exposed:
a red nightly is not wired to notify anyone, so it sat unactioned until the
manual report. Fixing that (a page or an issue on a failed run) is the
obvious next step.
