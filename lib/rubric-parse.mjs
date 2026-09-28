// Parses rubric.txt into structured criteria + scoring guidance.
// Plain JS so it can be shared by the Node build script and the Next.js app.

const ROLE_HEADERS = {
  'PRODUCT MANAGER (PM)': 'PM',
  'SENIOR PRODUCT MANAGER (SPM)': 'SPM',
};

const SLUGS = {
  'logistics operations from the inside': 'logistics_ops',
  'direct line to the frontline': 'frontline',
  'built the fix, got it adopted': 'built_fix',
  'owns it to closure, including failures': 'owns_closure',
  'makes calls without cover': 'calls_without_cover',
};

function slugify(name) {
  const known = SLUGS[name.toLowerCase()];
  if (known) return known;
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Split the file into { title: body } sections delimited by ===== rules. */
function sections(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (/^=+$/.test(lines[i].trim()) && i + 2 < lines.length && /^=+$/.test(lines[i + 2].trim())) {
      const title = lines[i + 1].trim();
      i += 3;
      const body = [];
      while (i < lines.length && !/^=+$/.test(lines[i].trim())) body.push(lines[i++]);
      out.push({ title, body: body.join('\n').trim() });
    } else {
      i++;
    }
  }
  return out;
}

function parseCriteria(role, body) {
  const blocks = body.split(/\n(?=Criterion name:)/).filter((b) => b.startsWith('Criterion name:'));
  return blocks.map((block, idx) => {
    const name = block.match(/^Criterion name:\s*(.+)$/m)[1].trim();
    const weightMatch = block.match(/^Weight:\s*(\d+(?:\.\d+)?)\s*%/m);
    if (!weightMatch) throw new Error(`No weight for ${role} / ${name}`);
    const anchor = (n) => {
      const m = block.match(new RegExp(`^\\s+${n} - ([\\s\\S]*?)(?=^\\s+\\d - |^Weight:)`, 'm'));
      return m ? m[1].replace(/\s+/g, ' ').trim() : '';
    };
    // Source runs from "Source:" to the next blank line (the role total line follows it).
    const at = block.search(/^Source:/m);
    const source = at < 0 ? '' : block.slice(at + 7).split(/\n\s*\n/)[0];
    return {
      id: `${role.toLowerCase()}_${slugify(name)}`,
      role,
      position: idx + 1,
      name,
      weight: Number(weightMatch[1]),
      anchor_5: anchor(5),
      anchor_3: anchor(3),
      anchor_1: anchor(1),
      source: source.replace(/\s+/g, ' ').trim(),
    };
  });
}

export function parseRubric(text) {
  const secs = sections(text);
  const criteria = [];
  const guidance = {};
  for (const s of secs) {
    const role = ROLE_HEADERS[s.title];
    if (role) {
      criteria.push(...parseCriteria(role, s.body));
    } else if (s.title === 'HOW TO SCORE') {
      guidance.how_to_score = s.body;
    } else if (s.title.startsWith('PATTERNS')) {
      guidance.patterns = s.body;
    } else if (s.title.startsWith('DO NOT REWARD')) {
      guidance.do_not_reward = `${s.title}\n${s.body}`;
    }
  }
  for (const role of ['PM', 'SPM']) {
    const rs = criteria.filter((c) => c.role === role);
    const total = rs.reduce((a, c) => a + c.weight, 0);
    if (rs.length < 4 || rs.length > 6) throw new Error(`${role} rubric must have 4-6 criteria, found ${rs.length}`);
    if (Math.abs(total - 100) > 0.001) throw new Error(`${role} weights sum to ${total}, expected 100`);
  }
  if (!guidance.how_to_score) throw new Error('rubric.txt is missing the HOW TO SCORE section');
  return { criteria, guidance };
}
