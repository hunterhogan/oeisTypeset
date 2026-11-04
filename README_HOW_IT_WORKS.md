# How oeisTypeset works

This is a map of the code, for people who want to contribute, customize the script or stylesheet, or check whether a rendering is a bug. [README.md](README.md) says what users should expect. This file says where in the code each of those behaviors comes from.

## The assembly line

```text
OEIS page
  │  src/semanticRoles.js   name each server container by what it is (oeisTypeset-<role> classes)
  │  src/main.js            pick the lines that may hold math; read each one into pieces
  ▼
pieces: text, A-number links, other elements
  │  src/oeisToLatex.js     lex → find math spans → parse → emit LaTeX → split into chunks
  ▼
LaTeX per chunk
  │  Temml                  LaTeX → MathML
  ▼
MathML spliced into the page, original nodes kept beside it
  │  oeisTypeset.user.css   every visual decision
  ▼
the browser's MathML engine and a math font lay it out
```

| File                                                 | Role                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [src/semanticRoles.js](src/semanticRoles.js)         | The only table of OEIS server class names, and the role each one gets                       |
| [src/oeisToLatex.js](src/oeisToLatex.js)             | The converter: OEIS notation in, LaTeX out. Pure, no DOM, runs in Node for tests            |
| [src/main.js](src/main.js)                           | Browser side: which sections and lines, DOM in and out, toggle, copy, A-number clicks       |
| [oeisTypeset.user.css](oeisTypeset.user.css)         | Stylus UserCSS: fonts, spacing, colors, the source toggle, the one reader option            |
| [tools/build.js](tools/build.js)                     | Concatenates the three `src/` files under the userscript metadata block, writes previews    |
| [dist/oeisTypeset.user.js](dist/oeisTypeset.user.js) | What people install. Generated; committed so the install link works                         |
| [test/test.js](test/test.js)                         | `npm test`: converter regressions, stylesheet/role consistency, `dist/` freshness, versions |
| [test/runCorpus.js](test/runCorpus.js)               | `npm run corpus`: every line of the saved pages through converter and Temml                 |
| [test/quick.js](test/quick.js)                       | One-off: print the LaTeX for strings given on the command line                              |
| [test/shotPage.js](test/shotPage.js)                 | Screenshot a preview page with Playwright                                                   |
| [tools/extractCorpus.py](tools/extractCorpus.py)     | Saved pages → `test/corpus.json` (lines as pieces, the same shape `main.js` builds)         |
| [corpus/](corpus/)                                   | Saved OEIS pages and the site's `styles.css`, used as fixtures                              |

## Let each tool do its job

Formulas look good here because this project does not typeset them. Temml turns LaTeX into MathML. The browser's MathML engine lays it out. A math font supplies the glyphs. Each was built for that job by people who know it better than we would.

So the project stays out of their way:

* The converter's only output is ordinary LaTeX. It makes the choices an author would make when writing LaTeX by hand, such as `\frac` or `\cfrac`, and which parentheses a 2-D layout makes redundant.
* The stylesheet chooses the math font and size. It does not position, scale, or respace anything inside a formula.
* There is one exception: *Fractions inside fractions*, a reader option that overrides MathML's shrinking of nested fractions.

If a formula looks wrong, first check whether the LaTeX is wrong. Fix that. Do not compensate with CSS on MathML elements or post-process Temml's output.

## Scope: which pages, sections and lines

| Decision                         | Where                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Pages the script runs on         | `@include` in the metadata block in [tools/build.js](tools/build.js)                                                                 |
| Pages the stylesheet applies to  | `@-moz-document regexp(...)` at the top of [oeisTypeset.user.css](oeisTypeset.user.css)                                              |
| Sections that are typeset        | `setSectionMath` in [src/main.js](src/main.js); the name line is handled in `typesetPage` (`div.seqname` up to its `<br>`)           |
| Lines that are layout (verbatim) | `isLineVerbatim` in [src/oeisToLatex.js](src/oeisToLatex.js), called from `typesetElement` in `main.js` and again in `convertPieces` |
| Lines set in the text face       | `typesetElement` in `main.js`: a line with math, or `isProse` (four or more words of three or more letters)                          |

`main.js` reads a line into pieces in `piecesOfElement`. A text node becomes `{kind: 'text'}`. An `<a href="/Annnnnn">` becomes `{kind: 'anumber'}`, and it stays atomic all the way through the converter. Any other element, such as a signature link or a `<br>`, becomes `{kind: 'opaque'}`. It ends a math span and is put back untouched.

**Verbatim rule** (`isLineVerbatim`): a line is layout if it starts with two or more spaces, or has a run of three or more identical characters from `-_=|+*\/#`. Otherwise, if it has runs of three or more spaces between non-spaces, it is layout unless the line holds a relation (`= == <= >= != <> := ~`) and every run is alignment. A run is alignment (`isRunAlignment`) if it sits between an operand and an operator, in either order.

## The converter, stage by stage

[src/oeisToLatex.js](src/oeisToLatex.js) is divided by banner comments, in this order. The file's header comment states its three design rules and the input and output shapes.

### Vocabulary

Every word the converter knows is in a table at the top of the file. To teach it a new function or symbol, start here.

| Table               | Holds                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------- |
| `mapGreek`          | Greek letter names → `\alpha` …; `Pi` and `pi` → `\pi`, `phi` → `\varphi`                             |
| `mapConstant`       | `oo`, `inf`, `infinity` → `\infty`                                                                    |
| `mapFunction`       | Names with their own LaTeX operator (`sin`, `log`, `gcd`, …). Unknown names become `\operatorname{…}` |
| `setLayoutFunction` | Functions that change layout: `sqrt`, `binomial`, `floor`, `ceiling`, `abs`                           |
| `mapBigOperator`    | `Sum`, `Product`, `Integral`, `lim`, `max`, … with sub- and superscripts                              |
| `setWordMath`       | Words that are math even with no operator beside them: the above, `mod`, `dx` …                       |
| `mapRelation`       | `=`, `==` → `\equiv`, `!=` and `<>` → `\ne`, `~` → `\sim`, `->` → `\to`, `\|` → `\mid` …              |
| `mapAdditive`       | `+`, `-`, `+-` → `\pm`, `-+` → `\mp`                                                                  |
| `setOperatorStrong` | Operators whose presence makes a span math rather than, say, a date                                   |

### Lexer

`listRuleLexer` is an ordered list of sticky regexes. Things that must not be read as math become `word` tokens before any math rule sees them: e-mail addresses written `(AT)`, URLs, abbreviations such as `G.f.`, and ordinals such as `2nd`. After an identifier or number, `regexCompound` and `regexPossessive` fold `-th`, `-axis` and `'s` into a prose word. `lexPieces` turns an A-number piece into one `anumber` token and an opaque piece into one `opaque` token.

### Span detection

`classifyToken` labels each token M (math), P (prose) or N (neutral: spaces and punctuation). Rules for identifiers are in `classifyIdentifier`: an identifier is math if it is one letter, contains a digit, is in `setWordMath`, or has `(`, `_`, `^` glued to it (also `!` and `'` for a single letter).

`findSpans` grows a span over M tokens and closes it at a P token. A bracket group is all-or-nothing, decided by `isGroupMath`. The group is atomic math when it is glued to something callable or to `_`/`^`, when it is `(mod …)`, or when nothing at its own level is prose. Otherwise its brackets are punctuation and the inside is searched on its own.

`trimSpan` drops trailing operators and commas, and leading `= * / ^ _`. `isSpanStrong` keeps a span only if it has a call, a math word, a big operator with `_`, or a strong operator. It rejects spans made of nothing but numbers, commas and dashes, and Mathematica (`Name[`).

### Parser

The parser is recursive descent with one function per level. From loosest to tightest:

| Level          | Function              | Operators                                                   |
| -------------- | --------------------- | ----------------------------------------------------------- |
| list           | `parseList`           | `,` `;` `:`                                                 |
| relation       | `parseRelation`       | `mapRelation`                                               |
| range          | `parseRange`          | `..`                                                        |
| additive       | `parseAdditive`       | `+ - +- -+`                                                 |
| multiplicative | `parseMultiplicative` | `* / mod X`, juxtaposition                                  |
| unary          | `parseUnary`          | leading `+ - +- -+`                                         |
| power          | `parsePower`          | `^`, right-associative                                      |
| postfix        | `parsePostfix`        | `! !! '` and `_`                                            |
| primary        | `parsePrimary`        | numbers, identifiers, calls, groups, `\|…\|`, big operators |

In `parseMultiplicative`, juxtaposition without a space (`2n`, `a(k)a(n-k)`) is bound first, so it binds tighter than `/`. `2n/3` is `(2n)/3`. Juxtaposition with a space binds like `*`. `expectClose` accepts a missing `)` at the end of a span, because truncated continued fractions are written that way. Any other surprise throws `ErrorParse`, and `convertPieces` leaves the span as original text.

### LaTeX emitter

`latex(node, context)` dispatches on `node.kind`. `context.isScript` is true inside sub- and superscripts, where fractions stay inline and binomials use `\tbinom`. The functions to look at for specific output:

| Output                                                       | Function                                                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `\frac` vs `\cfrac` vs inline `/`                            | `latex` → `fraction` handler, `containsFraction`                                                 |
| Dropped parentheses (`x^(n-1)` → `x^{n-1}`)                  | `latexStripped`, `latexOperand`                                                                  |
| `\left( … \right)` around tall content                       | `isTall`, `bracket`                                                                              |
| Sums, products, integrals, limits and their limits           | `latexBigOperator`                                                                               |
| `binomial`, `floor`, `sqrt`, named functions, A-number calls | `latexCall`                                                                                      |
| Identifiers (`a`, `x1`, `\operatorname{name}`)               | `latexSymbol`                                                                                    |
| A-numbers                                                    | `latexAnumber`: `\data{anumber=…}{\mathrm{A}…}`; `main.js` makes the resulting element clickable |
| The sign or space between two factors                        | `separatorProduct`                                                                               |

`separatorProduct` picks, in order:

| Case                                                                     | Output       | Example                        |
| ------------------------------------------------------------------------ | ------------ | ------------------------------ |
| `X`                                                                      | `\times`     | `2 X 3` → 2×3                  |
| `mod`                                                                    | `\bmod`      |                                |
| a factor is `\text{…}`                                                   | `\(space)`   |                                |
| a factor is `...`                                                        | none or `\,` |                                |
| right starts with a digit, and left ends with one or the operator is `*` | `\cdot`      | `2*3` → 2·3, `n*2` → n·2       |
| a factor is an A-number, or a call or power of one                       | `\,`         | `2*A014140(n)` → 2 A014140(n)  |
| juxtaposition with no space                                              | none         | `2n`, `a(k)a(n-k)`             |
| right is a group, or left is a number                                    | none         | `2*a` → 2a, `2*(n+1)` → 2(n+1) |
| anything else                                                            | `\,`         | `a(n)*b(n)` → a(n) b(n)        |

### Chunks

`chunksFromTree` splits the top of the tree at top-level commas, relations and the `+`/`-` of a top-level sum. `main.js` renders each chunk as its own `<math>`, so the browser can wrap a long formula between chunks. A chunk that starts with an operator gets `{}` in front so Temml spaces the operator as binary.

## DOM contract between script and stylesheet

The script only adds structure and class names. Every visual decision is in the stylesheet. The header comment of [src/main.js](src/main.js) is the authoritative list:

| Class or attribute                                     | Meaning                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| `.oeisTypeset-<role>`                                  | Every role in `semanticRoles.js`, on the server's containers        |
| `html.oeisTypeset-showSource`                          | Show original text everywhere (Violentmonkey menu)                  |
| `.oeisTypeset-section.oeisTypeset-showSource`          | Same, for one section (click its name)                              |
| `.oeisTypeset-toggleable`                              | A section whose lines were typeset                                  |
| `.oeisTypeset-prose`                                   | A line set in the text face                                         |
| `.oeisTypeset-verbatim`                                | A line whose spacing is layout; never altered                       |
| `span.oeisTypeset-formula[data-source]`                | One math span; `data-source` is the original text, used for copying |
| `> span.oeisTypeset-rendered > span.oeisTypeset-chunk` | The MathML, one `<math>` per chunk                                  |
| `> span.oeisTypeset-source`                            | The original nodes, hidden unless toggled                           |
| `[data-anumber]`                                       | An A-number inside MathML; `onClick` in `main.js` navigates         |

A MathML element cannot be an `<a>`, so `elementOfMath` gives each `[data-anumber]` a `title` copied from the original link and `role="link"`.

## The stylesheet

**Style roles, not server containers.** The OEIS markup is named after how it was built: `div.seqdatabox`, `div.sectline`. The script adds a class to each container naming what it is, and [the stylesheet](oeisTypeset.user.css) uses only those names.

```css
:root .oeisTypeset-entryName { ... }   /* yes */
div.seqname { ... }                    /* no */
```

CSS cannot alias a selector, and it cannot tell FORMULA from LINKS because it cannot read a section's name. That is why the script does the naming. [src/semanticRoles.js](src/semanticRoles.js) is the only file that holds the table of server names, so if the OEIS renames a container, that table is where the role gets repaired.

| Role (prefix `oeisTypeset-`)                              | What it is                                            | Server container                                              |
| --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `page`                                                    | The whole page                                        | `body`                                                        |
| `spacer`                                                  | Empty vertical space                                  | `div.space1`, `div.space4`, `div.space10`, `div.footerpad`    |
| `accountBar`                                              | Login link                                            | `div.loginbar`                                                |
| `masthead`                                                | Everything above the search box                       | `div.top`                                                     |
| `donorNotice`, `banner`, `announcement`, `memorialNotice` | Parts of the page top                                 | `div.donors`, `div.banner`, `div.motdbox`, `div.blackbar`     |
| `content`                                                 | The main column                                       | `div.pagebody`                                                |
| `search`, `searchGreeting`                                | Search box and its greeting                           | `div.searchbarcenter`, `div.searchgreet`                      |
| `entry`                                                   | One sequence                                          | `div.sequence`                                                |
| `entryRule`                                               | Line above the header                                 | `div.line`                                                    |
| `entryHeader`                                             | Band holding the title and reference count            | `div.seqhead`                                                 |
| `entryTitle`, `entryNumber`, `entryName`                  | A-number and name                                     | `div.seqnumname`, `div.seqnum`, `div.seqname`                 |
| `entryRefCount`                                           | Number at the right of the header                     | `div.scorerefs`                                               |
| `entryData`, `entryTerms`, `entryViews`                   | Terms box, the terms, and the list; graph; refs links | `div.seqdatabox`, `div.seqdata`, `div.seqdatalinks`           |
| `entrySections`                                           | All the sections                                      | `div.entry`                                                   |
| `section`, `sectionLabel`, `sectionBody`, `sectionLine`   | One section and its parts                             | `div.section`, `div.sectname`, `div.sectbody`, `div.sectline` |
| `footer`, `footerLinks`, `databaseInfo`, `legalNotice`    | The bottom of the page                                | `div.footer`, `div.linksbar`, `div.dbinfo`, `div.legal`       |

Each section also gets a family and a name of its own, read from its label (`mapSectionRoles`):

| Family             | Work the sections do    | Sections                                                                                 |
| ------------------ | ----------------------- | ---------------------------------------------------------------------------------------- |
| `familyExposition` | Explain the mathematics | `sectionComments`, `sectionFormula`, `sectionExample`                                    |
| `familyCode`       | Compute the sequence    | `sectionMaple`, `sectionMathematica`, `sectionProg`                                      |
| `familyCitation`   | Point elsewhere         | `sectionReferences`, `sectionLinks`, `sectionCrossrefs`                                  |
| `familyRecord`     | Describe the record     | `sectionOffset`, `sectionKeyword`, `sectionAuthor`, `sectionExtensions`, `sectionStatus` |

The typesetter's own roles (`listRoleTypesetter`) are in the DOM contract above.

Conventions in the stylesheet:

* **An empty block is where that change goes.** Every role has one, even if nothing styles it yet.
* **Say a thing once, at the highest role it is true of,** and let it inherit: `page` > `entry` > `section` > `sectionBody` > `sectionLine`. Prefer a family rule to three section rules. The server sets fonts directly on inner containers, so a role inherits those only by asking for `inherit`.
* **Start selectors with `:root`.** The server writes `div.name` rules, and one class alone loses to them.
* **Need a name that does not exist?** Add a role to `src/semanticRoles.js` and a block to the stylesheet, rather than reaching for a server name.
* Fonts are tokens near the top (`--oeisTypeset-fontText`, `--oeisTypeset-fontMath`, `--oeisTypeset-fontMono`, `--oeisTypeset-fontLayout`).

`npm test` fails on a server name in a stylesheet rule, on a role with no block, and on a block with no role.

## Is it a bug?

Work through these in order. Each step either explains the behavior or points to the stage at fault.

1. **Is the line in scope?** Check the page address, the section, and whether the line has `oeisTypeset-verbatim` (browser inspector). If it is verbatim, `isLineVerbatim` decided that.
2. **What did the converter see?** Toggle the section to original text. `data-source` on each `span.oeisTypeset-formula` is the exact text of each span. If a stretch you expected is not inside any formula span, span detection or `isSpanStrong` excluded it, or it failed to parse.
3. **What LaTeX does it produce?** `node test/quick.js "the text"` prints the LaTeX, or the parse error. Run it on the span's text, not the whole line, because `quick.js` parses its input as one formula and skips span detection.
4. **Is the LaTeX what a careful author would write?** If not, the bug is in the parser or emitter. If it is, and the drawing is still wrong, the cause is Temml, the browser's MathML, or the font. That is not this project's to patch with CSS.

## Develop

```shell
npm install
npm test                       # regression tests
npm run build                  # writes dist/oeisTypeset.user.js and test/preview/*.html
python -I tools/extractCorpus.py corpus test/corpus.json
npm run corpus                 # converts every line in corpus/, writes test/report.html
```

`test/preview/*.html` are the corpus pages with Temml, the script and the stylesheet injected directly, so you can check a change in Firefox without reinstalling anything. `test/shotPage.js` screenshots a preview page with Playwright, which is not a project dependency: `npm install --no-save playwright`. The README screenshots are in `.github/screenshots/`.

To see what a converter change does across the whole corpus, dump the LaTeX for every line before and after the change and diff the two dumps. `test/report.html` shows the rendered result next to the source.

### Editor setup

Open [.vscode/oeisTypeset.code-workspace](.vscode/oeisTypeset.code-workspace) in VS Code (File → Open Workspace from File) to get the project's settings:

* **Recommended extensions.** VS Code offers to install them: Code Spell Checker, Markdown All in One, Markdown Preview GitHub Styling, and markdownlint.
* **A project dictionary.** [.vscode/code-spell-dictionary-workspace.txt](.vscode/code-spell-dictionary-workspace.txt) holds the words Code Spell Checker should accept here: OEIS server class names (`seqdatabox`, `sectline`), LaTeX commands (`tbinom`, `operatorname`), and names such as Temml and Violentmonkey. Adding a flagged word to the `project-words` dictionary appends it to this file, so commit the file with your change.

`dist/oeisTypeset.user.js` is committed because it is what people install. Run `npm run build` before committing. To release, raise the version in `package.json` and in `oeisTypeset.user.css`, because the extensions only offer an update when the version goes up. `npm test` checks that both versions match and that `dist/` is current.
