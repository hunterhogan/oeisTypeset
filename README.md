# oeisTypeset

Typeset the formulas on OEIS sequence pages (`https://oeis.org/Annnnnn`) in Firefox.

`a(n) = Sum_{k=0..n} (-1)^k*binomial(n,k)*binomial(k,floor(k/2))` becomes a real summation with limits, binomial coefficients, and a floor, laid out by the browser's MathML engine.

## Pieces

| File | Runs in | Does |
|---|---|---|
| `dist/oeisTypeset.user.js` | Violentmonkey | Finds math in NAME, COMMENTS and FORMULA lines, converts OEIS notation to LaTeX, renders it to MathML with [Temml](https://temml.org), swaps it into the page |
| `oeisTypeset.user.css` | Stylus | All visual decisions: section spacing, text face for lines with math, math font, A-number links in formulas, the source toggle |

CSS alone cannot typeset a formula. Turning `Sum_{k=0..n}` into a summation needs a parser, and only a script can run one. The script adds structure and class names; the stylesheet decides how everything looks.

## Install

1. In Firefox, install [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/).
2. Open `dist/oeisTypeset.user.js` in Firefox (drag the file into a tab). Violentmonkey offers to install it.
3. Open `oeisTypeset.user.css` in Firefox the same way. Stylus offers to install it. Its one option, *Fractions inside fractions*, chooses full-size nested fractions (default) or TeX's shrinking.

Temml is loaded once from jsDelivr, pinned to an exact version, and cached by Violentmonkey.

## Use

* Formulas are typeset when the page loads.
* Click a section name (FORMULA, COMMENTS) to switch that section between typeset and original text. Violentmonkey's menu has the same toggle for the whole page.
* Copying a selection copies the original OEIS text of every formula in it, so code you paste still runs.
* A-numbers inside formulas are clickable. Ctrl+click opens a new tab.

## What is never touched

* EXAMPLE, PROG, MAPLE, MATHEMATICA, LINKS, REFERENCES, CROSSREFS: the script skips them.
* Any line whose spacing is layout: two or more leading spaces, three or more spaces in a row, or a run of `---`, `|||`, `===` and similar. These keep the site's monospace font, line height, and zero gap between rows, so ASCII diagrams stay intact.
* Any span that does not parse. It stays as the original text. The converter never makes a line worse.

## How the converter works (`src/oeisToLatex.js`)

The notation is specified by the [OEIS Style Sheet](https://oeis.org/wiki/Style_Sheet#Spelling_and_notation). No existing library parses it, so this is the one hand-written translator. Everything downstream is off the shelf.

1. **Lex** each line into tokens. A-number links stay atomic. Abbreviations (`G.f.`, `e.g.f.`), ordinals (`n-th`, `2nd`), hyphenated words (`x-axis`), possessives, e-mail addresses and URLs become prose words.
2. **Find math spans.** A token is math if it is a number, an operator, a single letter, a known math word (`Pi`, `oo`, `phi`, `mod`, Greek), or an identifier with `(`, `_`, `^` glued to it. English words end a span. A bracket group is atomic math unless prose lives at its own level, in which case its brackets are punctuation and its inside is searched separately. A span is typeset only if it holds a real operator, a call, or a math word, so dates and page ranges stay text.
3. **Parse** with precedence: list (`,`) < relation (`= == <= ~ -> |`) < range (`..`) < additive (`+ - +-`) < multiplicative (`* / mod X`, juxtaposition) < unary < power (`^`, right-assoc) < postfix (`! !! ' _`) < primary. Juxtaposition without a space (`2n`, `a(k)a(n-k)`) binds tighter than `/`. A missing `)` at the end of a span closes implicitly, which is how truncated continued fractions are written.
4. **Emit LaTeX.** `x^(n-1)` → `x^{n-1}`. `(a+b)/(c+d)` → `\frac{a+b}{c+d}`, or `\cfrac` when the denominator holds another fraction. Fractions inside exponents and subscripts stay inline as `a/b`. `Sum_{k=0..n}` puts `k=0` below and `n` above. Several ranges stack as `0 ≤ i ≤ n`. Also handled: `binomial` / two-argument `C` → `\binom`, `floor` / `ceiling`, `sqrt`, `(mod m)` → `\pmod`, `==` → `≡`, `oo` → `∞`, `Integral_{x=a..b} … dx`, `lim_{n->oo}`, Maple-style `Sum_(body, k, cond)`.
5. **Chunk** at top-level commas, relations and `+`/`-`, and render each chunk as its own `<math>`, so a long formula can wrap between chunks.

## Develop

```
npm install
npm test                       # regression tests
npm run build                  # writes dist/oeisTypeset.user.js and test/preview/*.html
python -I tools/extractCorpus.py corpus test/corpus.json
npm run corpus                 # converts every line in corpus/, writes test/report.html
```

`corpus/` holds saved sequence pages and the site's `styles.css`. `test/preview/*.html` are those pages with Temml, the script and the stylesheet injected directly, so you can check a change in Firefox without reinstalling anything. `test/shotPage.js` screenshots a preview page with Playwright.

## Known limits

* Umbral notation (`P(.,x)`, `(a.)^n`) and some typos do not parse. They stay as text.
* The OEIS serves pages with an HTML 3.2 doctype, so browsers render in quirks mode. Temml prints a console warning about this. MathML layout is unaffected.
* `https://oeis.org/history/view?seq=…` pages are not in scope yet.
