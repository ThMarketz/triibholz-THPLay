# The mark

An arm out of the water, holding the ball.

| file | body | accents | use it for |
|---|---|---|---|
| `thplay-mark.svg` | navy `#283655` | slate `#4d648d` | anything on white or light — print, invoices, the website on a pale section, a letterhead |
| `thplay-mark-dark.svg` | white `#ffffff` | slate `#4d648d` | anything on the app's own ground. **The app icons are built from this one.** |
| `thplay-mark-mono.svg` | `currentColor` | `currentColor` at 65% | inline in the UI, where it should follow the surrounding text and both looks at once |

All three are the same 367 control points. The variants differ only in their colour operators —
verified by parsing the path data out of all seven vendor files and comparing it numerically.

## Which one goes on which background

Contrast is not a taste question here; two of these combinations are unreadable.

| on | `#ffffff` body | `#4d648d` accent | `#283655` body |
|---|---|---|---|
| the app ground `#070f17` | **19.27:1** | 3.23:1 | **1.61:1 — unusable** |
| white | 1.00:1 — invisible | 5.96:1 | **12.01:1** |
| the vendor's own `#d0e1f9` | **1.33:1 — unusable** | 4.49:1 | **9.04:1** |

Graphics need 3:1. So: navy on light, white on dark, and never the other way round. The slate
accents clear 3:1 on the dark ground but only just — they are the two tick marks on the arm and
the two back waves, and they are *meant* to sit back. At 16 px they disappear entirely, which is
true of the whole mark at 16 px and is why the favicon is 64.

`tests/smoke.mjs` section **[17]** asserts the dark master is white-bodied and the light master is
navy-bodied, so the two can never be swapped by accident.

## How the icons are made

```bash
python3 scripts/build-icons.py            # redraw all five from thplay-mark-dark.svg
python3 scripts/build-icons.py --check    # fail if what is on disk has drifted  ← a gate
```

The mark is vector, so every size is **drawn** from the same curves rather than resampled from a
big PNG. There is no cairo, ghostscript, inkscape or imagemagick on the build machine and this app
ships with no runtime dependencies, so `scripts/vector.py` does the fill itself: cubics flattened
by recursive subdivision, then a scanline pass that is analytic across x and supersampled down y.

**It was checked rather than eyeballed.** Rendered against SmashingLogo's own 1200×867 raster
export of the same vector: **98.76% coverage IoU, 48 of 543,906 pixels differing by more than half
a pixel of coverage, total ink area within 0.06%, at zero offset.** The residue is antialiasing
filter shape. The same numbers come out whether the shapes are read from the vendor PDF or
re-parsed from the committed SVG, so the SVG round-trip is lossless.

Two platform rules, both of which fail silently if you get them wrong:

- **Icons are opaque.** iOS and Android composite onto their own square and round it themselves; a
  transparent PNG becomes a black box on some launchers. Every icon is painted onto `#070f17`.
- **A maskable icon only owns its inner 80%.** Android crops to a circle, a squircle or a teardrop
  depending on the launcher. The build asserts that not one ink pixel falls outside that circle.
  The inset is `0.56`; the measured maximum is `0.5715`, because the mark's furthest ink sits at
  0.7000 of its long side and a perfect square would be 0.7071 — this art really does reach its
  corners, so there is almost nothing to reclaim.

Every path is filled **even-odd**, and that is load-bearing: the body is one full-bleed outer
subpath plus three inner ones that the rule knocks out as the ball's seams. Fill it nonzero and
the ball goes solid.

## Where it came from, and what we may do with it

Bought from **SMASHINGLOGO** (smashinglogo.com), package `tfgvkk02`, **29 December 2020**,
PREMIUM. The receipt and the full vendor package are outside this repo, in the owner's Downloads
(`2020/package_print_tfgvkk02`, `package_highres_tfgvkk02`, and the purchase PDF beside them).
Font named on the receipt: *Boya* — not needed here, because this mark is icon-only and carries no
text. At the time of purchase the vendor's own terms named "SMASHINGLOGO and its creator Georg
Paul"; the GmbH appears only from April 2021, which is some evidence the terms were rewritten
around an incorporation *after* this purchase.

**Which text governs.** The nearest capture of the Terms before 29 December 2020 is
**2019-01-19**; the next is **2021-04-10**, three months *after*. So there is a 23-month gap
around the purchase date and the exact wording in force was never read. That matters, because the
two versions differ a great deal — and it is the later one that is friendlier to us.

### Verified in every version — 2019, 2021 and the current March-2024 text

These four sentences are stable across all three captures, so they were almost certainly in force:

- The vendor **retains the copyright** and all associated rights to the original design.
- The licence **does not allow** the user to sell, assign or transfer rights in the original design.
- **No trademark, copyright or service marks are conveyed** by the licence.
- The vendor has **no obligation to perform any clearance search** and says to run our own.

Also in all versions: no exclusivity clause of any kind, and — worth knowing — the vendor states
it keeps backups of all generated logos and *regularly checks whether they appear on the internet*.

### Only in the post-purchase text

The 2019 version's grant is narrow: the licence "allows you to use and display the customized
logo", and that is all. It contains **no** "any commercial or non-commercial purpose" grant, **no**
"full ownership of the purchased design as a whole" sentence, **no** Third Party Design Resources
section (so no Noun Project disclosure and no anti-sub-licensing clause) and **no** Hosting clause.
All of those first appear in April 2021.

So the broad commercial grant we would most like to rely on is the part that cannot be shown to
have been in force — and equally, the sub-licensing prohibition and the marketing giveback are
constraints that were not in force either. The terms do reserve the right to change unilaterally
with continued use as acceptance, which cuts both ways; for a completed one-off purchase by a
Swiss buyer that is weak authority for varying the deal retroactively. **There is no governing-law,
venue or arbitration clause in any version**, so which law construes any of this is unresolved.

What the pricing page said three weeks before the purchase does matter as a representation we
relied on: **"Full Ownership" was advertised** — and listed identically for Lite, Business *and*
Premium. PREMIUM bought more files, not more rights.

### What to actually do

- **Ship it.** It was sold as a logo for a business, advertised as full ownership, and there is no
  field-of-use limit, seat cap or time limit in any version. Branding a subscription product for
  clubs is within what was bought.
- **Don't claim we own the copyright.** The vendor retains it in every version and there is no
  signed assignment. Not to an investor, an acquirer, or a trademark examiner.
- **Register the wordmark** — *Triibholz* / *THPLAY* — not the icon. The icon is a simple symbol
  from a shared library; the obstacles to registering it are prior conflicting marks, the inherent
  weakness of a plain pictogram, and a third-party copyright exposure. (Concurrent use by others
  does not by itself defeat registrability — that was wrong in the first draft of this file.)
- **It cannot be assigned.** This is the solid constraint, present in all three versions. If the
  product is ever sold, the mark does not travel with it without consent. Know it now, not during
  diligence.
- **Before any reseller or white-label arrangement, get advice.** The prohibition on
  sub-licensing/redistributing design resources is post-purchase text, but it is the prudent
  assumption. Note the consent it calls for is from the **underlying rights owners** — icon
  contributors and foundries — not from SmashingLogo, who cannot waive their rights.
- **Clearance is ours.** Run an independent search before any filing.
- **The clean fix, if this mark is to carry a paid product long-term:** commission a bespoke
  redraw from a designer under a work-for-hire/assignment agreement, keeping the visual identity.
  That turns a non-exclusive library element into an asset we own, can assign and can register.
  The Noun Project's own guidance is that unmodified icons from its library may not be
  trademarked, while one modified enough to form part of the final design may allow the logo to be.

**None of this is legal advice.** It is a record of what the vendor's own published terms say
across four captures, what could not be read, and which of our conclusions rest on which.
