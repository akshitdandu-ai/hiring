// Reads rubric.txt and writes lib/rubric.generated.json, which the app uses to
// seed the rubric_criteria table on first run. Runs automatically before `next build`.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseRubric } from '../lib/rubric-parse.mjs';

const rubric = parseRubric(readFileSync(new URL('../rubric.txt', import.meta.url), 'utf8'));
writeFileSync(new URL('../lib/rubric.generated.json', import.meta.url), JSON.stringify(rubric, null, 2) + '\n');
for (const role of ['PM', 'SPM']) {
  const rs = rubric.criteria.filter((c) => c.role === role);
  console.log(`${role}: ${rs.map((c) => `${c.name} (${c.weight}%)`).join(', ')}`);
}
