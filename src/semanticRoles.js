/*
semanticRoles — the table of the OEIS server's containers and what each of them is.

The server's markup names things by how they were built (div.seqdatabox, div.sectline). This
table gives each of them a name for what it is. The userscript adds `oeisTypeset-<role>` to every
match, and oeisTypeset.user.css styles those roles only. If the server renames a container, this
table is where the role gets repaired.

CSS cannot do this alone: it has no way to alias a selector, and it cannot select a section by
the text of its name, so nothing in a stylesheet can tell FORMULA from LINKS.

test/test.js holds the stylesheet to this table: no server names in rules, no role without a
block, no block without a role.

Containers that only exist to center or wrap (div.center, div.bottom, div.searchbargreet, ...)
have no role, because there is nothing to say about them that a parent or child cannot say.
*/
(function (rootGlobal) {
	'use strict';

	/* Parents come before their children. */
	const listRole = [
		{ selector: 'body', role: 'page' },
		{ selector: 'div.space1, div.space4, div.space10, div.footerpad', role: 'spacer' },

		{ selector: 'div.loginbar', role: 'accountBar' },
		{ selector: 'div.top', role: 'masthead' },
		{ selector: 'div.donors', role: 'donorNotice' },
		{ selector: 'div.banner', role: 'banner' },
		{ selector: 'div.motdbox', role: 'announcement' },
		{ selector: 'div.blackbar', role: 'memorialNotice' },

		{ selector: 'div.pagebody', role: 'content' },
		{ selector: 'div.searchbarcenter', role: 'search' },
		{ selector: 'div.searchgreet', role: 'searchGreeting' },

		{ selector: 'div.sequence', role: 'entry' },
		{ selector: 'div.line', role: 'entryRule' },
		{ selector: 'div.seqhead', role: 'entryHeader' },
		{ selector: 'div.seqnumname', role: 'entryTitle' },
		{ selector: 'div.seqnum', role: 'entryNumber' },
		{ selector: 'div.seqname', role: 'entryName' },
		{ selector: 'div.scorerefs', role: 'entryRefCount' },
		{ selector: 'div.seqdatabox', role: 'entryData' },
		{ selector: 'div.seqdata', role: 'entryTerms' },
		{ selector: 'div.seqdatalinks', role: 'entryViews' },
		{ selector: 'div.entry', role: 'entrySections' },

		{ selector: 'div.section', role: 'section' },
		{ selector: 'div.sectname', role: 'sectionLabel' },
		{ selector: 'div.sectbody', role: 'sectionBody' },
		{ selector: 'div.sectline', role: 'sectionLine' },

		{ selector: 'div.footer', role: 'footer' },
		{ selector: 'div.linksbar', role: 'footerLinks' },
		{ selector: 'div.dbinfo', role: 'databaseInfo' },
		{ selector: 'div.legal', role: 'legalNotice' },
	];

	/* The text of a div.sectname -> the two extra roles of its div.section. A family groups the
	   sections that do the same kind of work, so one rule can reach all of them. */
	const mapSectionRoles = {
		COMMENTS: { family: 'familyExposition', role: 'sectionComments' },
		FORMULA: { family: 'familyExposition', role: 'sectionFormula' },
		EXAMPLE: { family: 'familyExposition', role: 'sectionExample' },

		MAPLE: { family: 'familyCode', role: 'sectionMaple' },
		MATHEMATICA: { family: 'familyCode', role: 'sectionMathematica' },
		PROG: { family: 'familyCode', role: 'sectionProg' },

		REFERENCES: { family: 'familyCitation', role: 'sectionReferences' },
		LINKS: { family: 'familyCitation', role: 'sectionLinks' },
		CROSSREFS: { family: 'familyCitation', role: 'sectionCrossrefs' },

		OFFSET: { family: 'familyRecord', role: 'sectionOffset' },
		KEYWORD: { family: 'familyRecord', role: 'sectionKeyword' },
		AUTHOR: { family: 'familyRecord', role: 'sectionAuthor' },
		EXTENSIONS: { family: 'familyRecord', role: 'sectionExtensions' },
		STATUS: { family: 'familyRecord', role: 'sectionStatus' },
	};

	/* Roles the typesetter gives to what it produces or decides, rather than to server markup. */
	const listRoleTypesetter = ['prose', 'verbatim', 'formula', 'rendered', 'chunk', 'source', 'toggleable', 'showSource'];

	const api = { listRole, mapSectionRoles, listRoleTypesetter };
	if (typeof module === 'object' && module.exports) {
		module.exports = api;
	} else {
		rootGlobal.semanticRoles = api;
	}
}(globalThis));
