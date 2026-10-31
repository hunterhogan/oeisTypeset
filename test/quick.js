const o = require('../src/oeisToLatex.js');
const temml = require('temml');
const list = process.argv.slice(2);
list.forEach((text) => {
	try {
		const l = o.latexOfFormula(text);
		console.log(text, '\n  =>', l);
		temml.renderToString(l, { throwOnError: true, trust: true });
	} catch (e) { console.log(text, '\n  !!', e.message); }
});
