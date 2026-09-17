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

Bought from **SMASHINGLOGO GmbH** (smashinglogo.com), package `tfgvkk02`, **29 December 2020**,
PREMIUM. The receipt and the full vendor package are outside this repo, in the owner's Downloads
(`2020/package_print_tfgvkk02`, `package_highres_tfgvkk02`, and the purchase PDF beside them).
Font named on the receipt: *Boya* — not needed here, because this mark is icon-only and carries no
text.

**This is a licence, not ownership, whatever the marketing says.** The Terms simultaneously state
that the vendor retains copyright in the original design and that the buyer has "full ownership of
the purchased design as a whole". Those cannot both be literally true. The reading consistent with
the rest of the document — which also says rights may not be sold, assigned or transferred, and
that no trademark or copyright "are being conveyed" — is a perpetual, non-exclusive,
non-transferable licence. There is no signed assignment. **Do not tell an investor, an acquirer or
a trademark examiner that we own the copyright.**

What that means in practice:

- **Commercial use is granted.** Branding a subscription product sold to clubs is fine. There is
  no field-of-use limit, no seat cap, no SaaS carve-out and no time limit. PREMIUM is a
  *deliverables* tier, not a rights tier — the vendor's own pricing page listed "Full Ownership"
  identically for Lite, Business and Premium, so PREMIUM bought more files, not more rights.
- **No attribution is required.**
- **The icon is not exclusive to us.** It is picked from a library the Terms say is sourced from
  third-party providers including the Noun Project. Other businesses may be using it right now.
- **Registering the icon alone as a trademark is the weak case** — a non-exclusive stock icon
  generally lacks the source-identifying distinctiveness registries want, and the underlying
  rights sit with its original contributor. **Register the wordmark** (*Triibholz* / *THPLAY*)
  first; that is where the distinctiveness is.
- **It cannot be assigned.** If the product is ever sold, the mark does not travel with it as an
  asset without the vendor's consent. Worth knowing now rather than during diligence.
- **It cannot be sub-licensed.** That is the one that bites a partner-resell or white-label model:
  letting a reseller use the mark under their own sub-licence, or shipping them the EPS, is close
  to redistributing design resources we do not own. Get written consent first.
- **Clearance is entirely ours.** The vendor disclaims any obligation to search, says use of the
  third-party symbols is at our own risk, and the indemnity runs in its favour. Run an independent
  clearance search before any trademark filing.
- **There is a giveback.** The Terms have the buyer grant SmashingLogo a worldwide, royalty-free,
  perpetual, non-exclusive licence to use the end product and the buyer's name for its marketing.

**If this mark is going to carry a paid product long-term, the clean fix is to commission a
bespoke redraw** from a designer under a work-for-hire/assignment agreement, keeping the visual
identity. That turns an unownable non-exclusive stock element into an asset we own, can assign and
can register. Until then, everything above is true and nothing above stops us shipping.

**Honest limit on this research.** The Internet Archive holds no capture of the Terms between
2015-11-20 and 2021-04-10, so the exact text in force on the purchase date was never read. The
three decisive clauses — vendor retains copyright, no transfer of rights, no trademark conveyed —
appear word-for-word in *both* the 2015 and the 2021 versions, which bracket the purchase, so they
were very likely in force. The most buyer-friendly language ("any commercial or non-commercial
purpose") is verified only from April 2021 onward, i.e. after the purchase. The live pages sit
behind a bot challenge and were not fetched. **None of this is legal advice.**
