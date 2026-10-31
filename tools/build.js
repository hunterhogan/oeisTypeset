/*
Assemble dist/oeisTypeset.user.js from the metadata block, the converter, and the browser code.
Also writes test/preview/<A-number>.html: saved OEIS pages with Temml, the script, and the
UserCSS injected directly, so a browser can show the result without any extension.

Usage: node tools/build.js
*/
const fs = require('fs');
const path = require('path');

const pathRoot = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(pathRoot, relative), 'utf8');
const packageJson = JSON.parse(read('package.json'));
const versionTemml = packageJson.dependencies.temml;

const metadata = `// ==UserScript==
// @name         oeisTypeset
// @namespace    https://github.com/hunterhogan/oeisTypeset
// @version      ${packageJson.version}
// @description  Typeset the formulas on OEIS sequence pages (OEIS notation -> LaTeX -> MathML via Temml).
// @author       Hunter Hogan
// @include      /^https:\\/\\/oeis\\.org\\/A\\d{6}(?:[?#].*)?$/
// @require      https://cdn.jsdelivr.net/npm/temml@${versionTemml}/dist/temml.min.js
// @grant        GM_registerMenuCommand
// @run-at       document-end
// @noframes
// ==/UserScript==
`;

const scriptBody = `${read('src/oeisToLatex.js')}\n${read('src/main.js')}`;
fs.mkdirSync(path.join(pathRoot, 'dist'), { recursive: true });
fs.writeFileSync(path.join(pathRoot, 'dist', 'oeisTypeset.user.js'), `${metadata}\n${scriptBody}`);

/* ---- preview pages */
const pathCorpus = process.env.OEIS_CORPUS || path.join(pathRoot, 'corpus');
if (fs.existsSync(pathCorpus)) {
	const userCss = read('oeisTypeset.user.css');
	const cssBody = userCss
		.replace(/\/\*\s*==UserStyle==[\s\S]*?==\/UserStyle==\s*\*\//, '')
		.replace(/@-moz-document[^\n]*\{\n/, '')
		.replace(/\}\s*$/, '')
		.replace(/\/\*\[\[fractionStyle\]\]\*\//g, 'normal');
	const temmlSource = read('node_modules/temml/dist/temml.min.js');
	const cssSite = fs.readFileSync(path.join(pathCorpus, 'styles.css'), 'utf8');
	fs.mkdirSync(path.join(pathRoot, 'test', 'preview'), { recursive: true });
	fs.readdirSync(pathCorpus).filter((name) => /^A\d{6}\.html$/.test(name)).forEach((name) => {
		const html = fs.readFileSync(path.join(pathCorpus, name), 'utf8')
			.replace(/<link rel="stylesheet" href="\/styles\.css[^"]*">/, () => `<style>${cssSite}</style><style>${cssBody}</style>`)
			.replace(/<body[^>]*>/, '<body>')
			.replace('</body>', () => `<script>${temmlSource}</script><script>${scriptBody}</script></body>`);
		fs.writeFileSync(path.join(pathRoot, 'test', 'preview', name), html);
	});
}
console.log('built dist/oeisTypeset.user.js');
