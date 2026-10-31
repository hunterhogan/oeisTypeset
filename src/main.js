/*
oeisTypeset — browser side. Finds the lines of a sequence page that can hold formulas, asks
oeisToLatex for math spans, renders each span with Temml to MathML, and swaps it in.

Contract with oeisTypeset.user.css (the CSS owns every visual decision; this script only
adds structure and class names):
	html.oeisTypeset-showSource      show original text everywhere instead of rendered math
	div.section.oeisTypeset-showSource   same, for one section (click its name to toggle)
	div.section.oeisTypeset-section  a section that was processed
	.oeisTypeset-prose               a line set in a text face (it has math or is plainly prose)
	.oeisTypeset-verbatim            a line whose spacing is layout; never altered
	span.oeisTypeset-formula         one math span, data-source = original text
	  > span.oeisTypeset-rendered    the MathML chunks
	  > span.oeisTypeset-source      the original nodes (hidden unless toggled)
	[data-anumber]                   an A-number inside rendered math (clickable)
*/
(function () {
	'use strict';

	const setSectionMath = new Set(['FORMULA', 'COMMENTS']);
	const optionsTemml = { throwOnError: true, trust: (context) => context.command === '\\data', strict: false };
	const regexAnumberHref = /^\/A\d{6}$/;

	function render(latexString) {
		return temml.renderToString(`\\displaystyle ${latexString}`, optionsTemml);
	}

	function piecesOfElement(element, nodeStop) {
		const listNode = [];
		const listPiece = [];
		Array.from(element.childNodes).some((node) => {
			if (node === nodeStop) {
				return true;
			}
			listNode.push(node);
			if (node.nodeType === Node.TEXT_NODE) {
				listPiece.push({ kind: 'text', text: node.nodeValue });
			} else if (node.nodeName === 'A' && regexAnumberHref.test(node.getAttribute('href') || '')) {
				listPiece.push({ kind: 'anumber', text: node.textContent, href: node.getAttribute('href'), title: node.getAttribute('title') || '' });
			} else {
				listPiece.push({ kind: 'opaque', text: (node.nodeName === 'BR' && '\n') || node.textContent });
			}
			return false;
		});
		return { listNode, listPiece };
	}

	function fragmentOfParts(listPart, listNode) {
		const fragment = document.createDocumentFragment();
		listPart.forEach((part) => {
			if (part.kind === 'source') {
				fragment.append(document.createTextNode(part.text));
			} else {
				fragment.append(listNode[part.idPiece]);
			}
		});
		return fragment;
	}

	function elementOfMath(segment, listNode, listPiece) {
		const formula = document.createElement('span');
		formula.className = 'oeisTypeset-formula';
		formula.dataset.source = segment.source;
		const rendered = document.createElement('span');
		rendered.className = 'oeisTypeset-rendered';
		segment.chunks.forEach((chunk, index) => {
			if (index > 0) {
				rendered.append(document.createTextNode(chunk.gap || '​'));
			}
			const span = document.createElement('span');
			span.className = 'oeisTypeset-chunk';
			span.innerHTML = chunk.rendered;
			rendered.append(span);
		});
		const mapTitle = new Map(segment.listPart.filter((part) => part.kind === 'piece' && listPiece[part.idPiece].kind === 'anumber')
			.map((part) => [listPiece[part.idPiece].text, listPiece[part.idPiece].title]));
		rendered.querySelectorAll('[data-anumber]').forEach((element) => {
			element.setAttribute('title', mapTitle.get(element.dataset.anumber) || element.dataset.anumber);
			element.setAttribute('role', 'link');
		});
		const source = document.createElement('span');
		source.className = 'oeisTypeset-source';
		source.append(fragmentOfParts(segment.listPart, listNode));
		formula.append(rendered, source);
		return formula;
	}

	function isProse(text) {
		return (text.match(/[A-Za-z]{3,}/g) || []).length >= 4;
	}

	/* Replace the children of `element` (up to `nodeStop`) with rendered segments. */
	function typesetElement(element, nodeStop) {
		const { listNode, listPiece } = piecesOfElement(element, nodeStop);
		const text = listPiece.map((piece) => piece.text).join('');
		if (oeisToLatex.isLineVerbatim(text)) {
			element.classList.add('oeisTypeset-verbatim');
			return;
		}
		const listSegment = oeisToLatex.convertPieces(listPiece, render);
		const hasMath = listSegment.some((segment) => segment.kind === 'math');
		if (hasMath || isProse(text)) {
			element.classList.add('oeisTypeset-prose');
		}
		if (!hasMath) {
			return;
		}
		const fragment = document.createDocumentFragment();
		listSegment.forEach((segment) => {
			if (segment.kind === 'math') {
				fragment.append(elementOfMath(segment, listNode, listPiece));
			} else {
				fragment.append(fragmentOfParts([segment], listNode));
			}
		});
		/* Links and other elements were moved into the fragment; the old text nodes remain. */
		listNode.filter((node) => node.parentNode === element).forEach((node) => node.remove());
		element.insertBefore(fragment, nodeStop || null);
	}

	function safely(action) {
		try {
			action();
		} catch (error) {
			console.warn('oeisTypeset:', error);
		}
	}

	function typesetPage() {
		document.querySelectorAll('div.section').forEach((section) => {
			const name = section.querySelector('div.sectname');
			if (!name || !setSectionMath.has(name.textContent.trim())) {
				return;
			}
			section.classList.add('oeisTypeset-section');
			name.title = 'Click to toggle between typeset formulas and the original text';
			name.addEventListener('click', () => section.classList.toggle('oeisTypeset-showSource'));
			section.querySelectorAll('div.sectline').forEach((line) => safely(() => typesetElement(line, null)));
		});
		const seqname = document.querySelector('div.seqname');
		if (seqname) {
			safely(() => typesetElement(seqname, seqname.querySelector('br')));
		}
	}

	/* An A-number inside MathML cannot be an <a>; make it behave like one. */
	function onClick(event) {
		const target = event.target.closest && event.target.closest('[data-anumber]');
		if (!target) {
			return;
		}
		const url = `/${target.dataset.anumber}`;
		if (event.ctrlKey || event.metaKey || event.button === 1) {
			window.open(url, '_blank');
		} else {
			window.location.href = url;
		}
	}

	/* Copying a selection yields the original OEIS text for every formula in it. */
	function onCopy(event) {
		const selection = window.getSelection();
		if (!selection || selection.rangeCount === 0) {
			return;
		}
		const fragment = selection.getRangeAt(0).cloneContents();
		const listFormula = fragment.querySelectorAll('.oeisTypeset-formula');
		const isInsideFormula = selection.anchorNode && selection.anchorNode.parentElement && selection.anchorNode.parentElement.closest('.oeisTypeset-formula');
		if (listFormula.length === 0 && !isInsideFormula) {
			return;
		}
		if (listFormula.length === 0) {
			event.clipboardData.setData('text/plain', isInsideFormula.dataset.source);
			event.preventDefault();
			return;
		}
		listFormula.forEach((formula) => {
			formula.replaceWith(document.createTextNode(formula.dataset.source || ''));
		});
		fragment.querySelectorAll('.oeisTypeset-source').forEach((source) => source.remove());
		event.clipboardData.setData('text/plain', fragment.textContent);
		event.preventDefault();
	}

	function toggleSourceEverywhere() {
		document.documentElement.classList.toggle('oeisTypeset-showSource');
	}

	typesetPage();
	document.addEventListener('click', onClick);
	document.addEventListener('copy', onCopy);
	if (typeof GM_registerMenuCommand === 'function') {
		GM_registerMenuCommand('Toggle typeset / original text', toggleSourceEverywhere);
	}
}());
