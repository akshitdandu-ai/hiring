import { config, missingEnv, ROLE_LABEL, ROLES } from '@/lib/config';
import { getRubric } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rubric · Kargo Hiring' };

export default async function RubricPage() {
  if (missingEnv().includes('DATABASE_URL')) {
    return <div className="notice err">DATABASE_URL is not set.</div>;
  }
  let rubric;
  try {
    rubric = await getRubric();
  } catch (e) {
    return <div className="notice err">Could not reach the database: {(e as Error).message}</div>;
  }
  return (
    <>
      <h1>Hiring rubric</h1>
      <p className="muted">
        Derived from the 8 past hire profiles and their outcomes - not from the job descriptions. Loaded from rubric.txt into
        the <code>rubric_criteria</code> table; every CV is scored against both roles. Models (in order of preference): {config.geminiModels.join(', ')}.
      </p>
      {ROLES.map((role) => {
        const rows = rubric.criteria.filter((c) => c.role === role);
        return (
          <div className="card" key={role}>
            <h2 style={{ marginTop: 0 }}>{ROLE_LABEL[role]} ({role}) · {rows.reduce((a, c) => a + Number(c.weight), 0)}%</h2>
            <table>
              <thead><tr><th>Criterion</th><th>Weight</th><th>5 - strong</th><th>3 - partial</th><th>1 - absent</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b><div className="small muted">{c.source}</div></td>
                    <td>{c.weight}%</td>
                    <td className="small">{c.anchor_5}</td>
                    <td className="small">{c.anchor_3}</td>
                    <td className="small">{c.anchor_1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {rubric.guidance.do_not_reward && (
        <div className="card"><pre style={{ whiteSpace: 'pre-wrap', margin: 0, font: 'inherit' }}>{rubric.guidance.do_not_reward}</pre></div>
      )}
    </>
  );
}
