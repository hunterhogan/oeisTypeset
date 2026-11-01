# oeisTypeset

Typeset the formulas on OEIS sequence pages (`https://oeis.org/Annnnnn`) in Firefox.

`a(n) = Sum_{k=0..n} (-1)^k*binomial(n,k)*binomial(k,floor(k/2))` becomes a real summation with limits, binomial coefficients, and a floor, laid out by the browser's MathML engine.

## Pieces

| File                       | Runs in       | Does                                                                                                                                                          |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dist/oeisTypeset.user.js` | Violentmonkey | Finds math in NAME, COMMENTS and FORMULA lines, converts OEIS notation to LaTeX, renders it to MathML with [Temml](https://temml.org), swaps it into the page |
| `oeisTypeset.user.css`     | Stylus        | All visual decisions: section spacing, text face for lines with math, math font, A-number links in formulas, the source toggle                                |

CSS alone cannot typeset a formula. Turning `Sum_{k=0..n}` into a summation needs a parser, and only a script can run one. The script adds structure and class names; the stylesheet decides how everything looks. Install both. If the script does not run, the stylesheet has nothing to attach to and the page stays as the OEIS serves it.

## Let each tool do its job

Formulas look good here because this project does not typeset them. Temml turns LaTeX into MathML. The browser's MathML engine lays it out. A math font supplies the glyphs. Each was built for that job by people who know it better than we would.

So the project stays out of their way:

* The converter's only output is ordinary LaTeX. It makes the choices an author would make when writing LaTeX by hand, such as `\frac` or `\cfrac`, and which parentheses a 2-D layout makes redundant.
* The stylesheet chooses the math font and size. It does not position, scale, or respace anything inside a formula.
* There is one exception: *Fractions inside fractions*, a reader option that overrides MathML's shrinking of nested fractions.

If a formula looks wrong, first check whether the LaTeX is wrong. Fix that. Do not compensate with CSS on MathML elements or post-process Temml's output.

## Install

Both pieces go in Firefox. Installing from these links also gives you updates.

1. Install [Violentmonkey](https://addons.mozilla.org/firefox/addon/violentmonkey/) and [Stylus](https://addons.mozilla.org/firefox/addon/styl-us/).
2. Open [oeisTypeset.user.js](https://raw.githubusercontent.com/hunterhogan/oeisTypeset/main/dist/oeisTypeset.user.js). Violentmonkey offers to install it.
3. Open [oeisTypeset.user.css](https://raw.githubusercontent.com/hunterhogan/oeisTypeset/main/oeisTypeset.user.css). Stylus offers to install it. Its one option, *Fractions inside fractions*, chooses full-size nested fractions (default) or TeX's shrinking.

Temml is loaded once from jsDelivr, pinned to an exact version, and cached by Violentmonkey.

### If a link only shows text, or you have a local copy

#### Script

1. Click the Violentmonkey icon, then settings.
2. In the dashboard, click `+` and choose to create a new script from a file.
3. Browse to `dist/oeisTypeset.user.js`.

#### Stylesheet

Stylus's *load from file* option only accepts JSON, so it will not take this file. Stylus documents opening a local `.user.css` with Ctrl+O, or dragging it onto the tab bar. If that does not bring up an install page, paste it in:

1. Open any `https://oeis.org` page and click the Stylus icon. It should say no styles are installed.
2. Click the `+` icon. It is always visible and easy to miss. A CSS editor opens.
3. Make sure *Write new style as UserCSS* is unchecked. The import icon only appears while it is unchecked.
4. Click the import icon, paste the whole of `oeisTypeset.user.css` into the box, and save.
5. Check *Write new style as UserCSS*. The style does not work until you do.

A style installed this way does not update itself.

## Use

* Formulas are typeset when the page loads.
* Click a section name (FORMULA, COMMENTS) to switch that section between typeset and original text. Violentmonkey's menu has the same toggle for the whole page.
* Copying a selection copies the original OEIS text of every formula in it, so code you paste still runs.
* A-numbers inside formulas are clickable. Ctrl+click opens a new tab.

## What is never touched

* EXAMPLE, PROG, MAPLE, MATHEMATICA, LINKS, REFERENCES, CROSSREFS: the script does not typeset them.
* Any line whose spacing is layout: two or more leading spaces, three or more spaces between cells, or a run of `---`, `|||`, `===` and similar. These keep the site's monospace font, line height, and zero gap between rows, so ASCII diagrams stay intact.
* Any span that does not parse. It stays as the original text. The converter never makes a line worse.

Spaces that only line up an equation are not layout. In `A076876(n)   = [T(n,3) -     T(n,2)]/2` each run of spaces touches an operator, and the line holds a relation, so it is typeset. The spaces have no effect on the formula, and the original text view and copying keep them. If a run of three or more sits anywhere else on the line, such as between two values, the whole line stays verbatim.

## How the converter works (`src/oeisToLatex.js`)

The notation is specified by the [OEIS Style Sheet](https://oeis.org/wiki/Style_Sheet#Spelling_and_notation). No existing library parses it, so this is the one hand-written translator. Everything downstream is off the shelf.

1. **Lex** each line into tokens. A-number links stay atomic. Abbreviations (`G.f.`, `e.g.f.`), ordinals (`n-th`, `2nd`), hyphenated words (`x-axis`), possessives, e-mail addresses and URLs become prose words.
2. **Find math spans.** A token is math if it is a number, an operator, a single letter, a known math word (`Pi`, `oo`, `phi`, `mod`, Greek), or an identifier with `(`, `_`, `^` glued to it. English words end a span. A bracket group is atomic math unless prose lives at its own level, in which case its brackets are punctuation and its inside is searched separately. A span is typeset only if it holds a real operator, a call, or a math word, so dates and page ranges stay text.
3. **Parse** with precedence: list (`,`) < relation (`= == <= ~ -> |`) < range (`..`) < additive (`+ - +-`) < multiplicative (`* / mod X`, juxtaposition) < unary < power (`^`, right-assoc) < postfix (`! !! ' _`) < primary. Juxtaposition without a space (`2n`, `a(k)a(n-k)`) binds tighter than `/`. A missing `)` at the end of a span closes implicitly, which is how truncated continued fractions are written.
4. **Emit LaTeX.** `x^(n-1)` → `x^{n-1}`. `(a+b)/(c+d)` → `\frac{a+b}{c+d}`, or `\cfrac` when the denominator holds another fraction. Fractions inside exponents and subscripts stay inline as `a/b`. `Sum_{k=0..n}` puts `k=0` below and `n` above. Several ranges stack as `0 ≤ i ≤ n`. Also handled: `binomial` / two-argument `C` → `\binom`, `floor` / `ceiling`, `sqrt`, `(mod m)` → `\pmod`, `==` → `≡`, `oo` → `∞`, `Integral_{x=a..b} … dx`, `lim_{n->oo}`, Maple-style `Sum_(body, k, cond)`.
5. **Chunk** at top-level commas, relations and `+`/`-`, and render each chunk as its own `<math>`, so a long formula can wrap between chunks.

## Change the stylesheet

**Style roles, not server containers.** The OEIS markup is named after how it was built: `div.seqdatabox`, `div.sectline`. The script adds a class to each container naming what it is, and [the stylesheet](oeisTypeset.user.css) uses only those names.

```css
:root .oeisTypeset-entryName { ... }   /* yes */
div.seqname { ... }                    /* no */
```

CSS cannot alias a selector, and it cannot tell FORMULA from LINKS because it cannot read a section's name. That is why the script does the naming. [`src/semanticRoles.js`](src/semanticRoles.js) is the only file that holds the table of server names, so if the OEIS renames a container, that table is where the role gets repaired.

| Role (prefix `oeisTypeset-`)                              | What it is                                            | Server container                                               |
| --------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| `page`                                                    | The whole page                                        | `body`                                                         |
| `spacer`                                                  | Empty vertical space                                  | `div.space1`, `div.space4`, `div.space10`, `div.footerpad`     |
| `accountBar`                                              | Login link                                            | `div.loginbar`                                                 |
| `masthead`                                                | Everything above the search box                       | `div.top`                                                      |
| `donorNotice`, `banner`, `announcement`, `memorialNotice` | Parts of the page top                                 | `div.donors`, `div.banner`, `div.motdbox`, `div.blackbar`      |
| `content`                                                 | The main column                                       | `div.pagebody`                                                 |
| `search`, `searchGreeting`                                | Search box and its greeting                           | `div.searchbarcenter`, `div.searchgreet`                       |
| `entry`                                                   | One sequence                                          | `div.sequence`                                                 |
| `entryRule`                                               | Line above the header                                 | `div.line`                                                     |
| `entryHeader`                                             | Band holding the title and reference count            | `div.seqhead`                                                  |
| `entryTitle`, `entryNumber`, `entryName`                  | A-number and name                                     | `div.seqnumname`, `div.seqnum`, `div.seqname`                  |
| `entryRefCount`                                           | Number at the right of the header                     | `div.scorerefs`                                                |
| `entryData`, `entryTerms`, `entryViews`                   | Terms box, the terms, and the list; graph; refs links | `div.seqdatabox`, `div.seqdata`, `div.seqdatalinks`            |
| `entrySections`                                           | All the sections                                      | `div.entry`                                                    |
| `section`, `sectionLabel`, `sectionBody`, `sectionLine`   | One section and its parts                             | `div.section`, `div.sectname`, `div.sectbody`, `div.sectline`  |
| `footer`, `footerLinks`, `databaseInfo`, `legalNotice`    | The bottom of the page                                | `div.footer`, `div.linksbar`, `div.dbinfo`, `div.legal`        |

Each section also gets a family and a name of its own, read from its label:

| Family             | Work the sections do    | Sections                                                                                 |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------- |
| `familyExposition` | Explain the mathematics | `sectionComments`, `sectionFormula`, `sectionExample`                                    |
| `familyCode`       | Compute the sequence    | `sectionMaple`, `sectionMathematica`, `sectionProg`                                      |
| `familyCitation`   | Point elsewhere         | `sectionReferences`, `sectionLinks`, `sectionCrossrefs`                                  |
| `familyRecord`     | Describe the record     | `sectionOffset`, `sectionKeyword`, `sectionAuthor`, `sectionExtensions`, `sectionStatus` |

The typesetter adds the rest: `prose` and `verbatim` lines, `formula`, `rendered`, `chunk` and `source` spans, `toggleable` sections, and the `showSource` state.

Rules for working in the stylesheet:

* **An empty block is where that change goes.** Every role has one, even if nothing styles it yet. Find the role and write there.
* **Say a thing once, at the highest role it is true of,** and let it inherit: `page` > `entry` > `section` > `sectionBody` > `sectionLine`. Prefer a family rule to three section rules. The server sets fonts directly on inner containers, so a role inherits those only by asking for `inherit`.
* **Start selectors with `:root`.** The server writes `div.name` rules, and one class alone loses to them.
* **Need a name that does not exist?** Add a role to `src/semanticRoles.js` and a block to the stylesheet, rather than reaching for a server name.

`npm test` fails on a server name in a stylesheet rule, on a role with no block, and on a block with no role.

## Develop

```shell
npm install
npm test                       # regression tests
npm run build                  # writes dist/oeisTypeset.user.js and test/preview/*.html
python -I tools/extractCorpus.py corpus test/corpus.json
npm run corpus                 # converts every line in corpus/, writes test/report.html
```

`corpus/` holds saved sequence pages and the site's `styles.css`. `test/preview/*.html` are those pages with Temml, the script and the stylesheet injected directly, so you can check a change in Firefox without reinstalling anything. `test/shotPage.js` screenshots a preview page with Playwright, which is not a project dependency: `npm install --no-save playwright`.

`dist/oeisTypeset.user.js` is committed because it is what people install. Run `npm run build` before committing. To release, raise the version in `package.json` and in `oeisTypeset.user.css`, because the extensions only offer an update when the version goes up. `npm test` checks that both versions match and that `dist/` is current.

## Known limits

* Umbral notation (`P(.,x)`, `(a.)^n`) and some typos do not parse. They stay as text.
* The OEIS serves pages with an HTML 3.2 doctype, so browsers render in quirks mode. Temml prints a console warning about this. MathML layout is unaffected.
* `https://oeis.org/history/view?seq=…` pages are not in scope yet.

## License

[CC BY-NC 4.0](LICENSE), except `corpus/`, which is OEIS content under CC BY-SA 4.0 ([details](corpus/README.md)). [Temml](https://temml.org) is MIT licensed and loaded from a CDN, not bundled.
