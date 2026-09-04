export function synthesizeInstructions(citable: string[], actionsTaken: string[], planIntent: string): string {
  return `Produce the final structured answer now by calling emit_answer. Constraints:
- Every policy_fact must cite at least one chunk_id from this list, copied exactly: ${citable.length ? citable.join(', ') : '(none retrieved — then policy_facts must be empty and you must say the evidence is missing)'}.
- A fact you cannot cite is not a fact; leave it out rather than guess.
- recommendations are guidance, each with basis_fact_ids pointing at facts above.
- applicability: the acting person's workforce class and a one-line note on which documents bind them, citing HANDBOOK §2 if retrieved.
- withheld_by_audience: fill it if any search reported withheld documents; explain plainly that those policies are not available to this role.
- escalation.target: none unless the situation needs a person (hr_partner, manager, creator_partnerships, security, editorial_standards) or is out_of_scope.
- actions_taken must reflect exactly these tool results and nothing else: ${actionsTaken.length ? actionsTaken.join('; ') : 'none'}. Never say something was sent.
- Plan intent was "${planIntent}". For out_of_scope: no policy_facts unless they are the redirect topic; say what you cannot answer.
- answer_markdown: 2–6 short sentences, direct, "you"-voice, no headings, no restating the citations list.`;
}
