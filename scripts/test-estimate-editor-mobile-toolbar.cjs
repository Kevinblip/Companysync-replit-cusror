const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('src/pages/EstimateEditor.jsx', 'utf8');
const pageStart = source.indexOf('return (\n    <div className="p-3 sm:p-6 space-y-6 bg-gray-50');
assert.notEqual(pageStart, -1, 'estimate editor page wrapper exists');
const toolbarStart = source.indexOf('data-testid="button-material-list-mobile"', pageStart);
assert.notEqual(toolbarStart, -1, 'mobile Material List action exists in the estimate toolbar');
const toolbar = source.slice(pageStart, source.indexOf('{revisionChain.length > 0', pageStart));
assert.match(toolbar, /flex flex-col gap-3 md:flex-row md:items-center md:justify-between/,
  'header stacks actions on mobile and returns to a row at desktop widths');
assert.match(toolbar, /flex flex-wrap items-center gap-2 md:gap-4 min-w-0/,
  'estimate title and badges wrap without forcing horizontal overflow');
assert.match(toolbar, /flex flex-wrap items-center gap-2 w-full md:w-auto/,
  'action buttons wrap to the available viewport width');
const materialButtonStart = source.lastIndexOf('<Button', toolbarStart);
const materialButtonEnd = source.indexOf('</Button>', toolbarStart) + '</Button>'.length;
const materialButton = source.slice(materialButtonStart, materialButtonEnd);
assert.match(materialButton, /md:hidden/, 'direct Material List action appears below the desktop breakpoint');
assert.match(materialButton, /onClick=\{handleGenerateMaterialList\}/,
  'the mobile action uses the existing material-list generation flow');
assert.match(materialButton, /disabled=\{isGeneratingMaterials \|\| !lineItems \|\| lineItems\.length === 0\}/,
  'the mobile action shares the existing loading and empty-estimate guard');
console.log('Estimate editor mobile toolbar checks passed.');