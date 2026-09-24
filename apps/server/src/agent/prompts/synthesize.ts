export function synthesizeInstructions(citable: string[], actionsTaken: string[], planIntent: string, pendingAction?: string): string {
  const ids = citable.length ? citable.map((c) => `  - ${c}`).join('\n') : '  (none retrieved)';
  return `Produce the final structured answer now by calling emit_answer. Hard rules:
1. policy_facts is REQUIRED and must not be empty whenever your answer states anything a policy says (a rule, a figure, a threshold, a deadline, who approves, what is or is not covered). Put each such statement in policy_facts as its own fact, one rule per fact, with the figure in it. An answer_markdown that states rules while policy_facts is empty is a failed answer.
2. Every fact cites at least one chunk_id copied EXACTLY from this list (these are the chunks retrieved this turn; nothing else is citable):
${ids}
   Pick the chunk whose doc_id/section matches the rule. If a rule you want to state has no matching chunk, leave it out and say the evidence did not cover it.
3. answer_markdown is the short conversational version (2–6 sentences, "you"-voice, no headings, no citation list). It may summarise the facts but must not introduce a rule that is not in policy_facts.
4. recommendations are guidance (what to do next), each with basis_fact_ids pointing at the facts it rests on. A recommendation with no basis is dropped.
5. applicability: the acting person's workforce_class and a one-line note on which documents bind them; cite the HANDBOOK §2 chunk if it is in the list.
6. withheld_by_audience: fill it if any search reported withheld documents, and say plainly that those policies are not available to this role.
7. escalation.target: none unless a person is needed (hr_partner, manager, creator_partnerships, security, editorial_standards) or the question is out_of_scope.
8. actions_taken must reflect exactly these tool results and nothing else: ${actionsTaken.length ? actionsTaken.join('; ') : 'none'}. Never say something was sent.${pendingAction ? `
8a. An action is waiting for the user's confirmation and has NOT run: ${pendingAction}. Answer the question in full from the evidence first (the verdict, the figures, the rule), then end answer_markdown with one sentence saying the action is ready for their confirmation. Do not say it was created, drafted or sent, and do not list it in actions_taken.` : ''}
9. Plan intent was "${planIntent}". For out_of_scope: no policy_facts except the redirect topic; say what you cannot answer and where the nearest policy is.`;
}

export function repairInstructions(citable: string[]): string {
  return `Your draft answer states policy rules but emit_answer received no policy_facts, so nothing is citable. Call emit_answer again. Extract every rule, figure, threshold or condition from the draft into policy_facts (one per fact), each citing at least one chunk_id copied exactly from this list:
${citable.map((c) => `  - ${c}`).join('\n')}
Keep only rules that a listed chunk supports; drop the rest from both the facts and the summary. Then rewrite answer_markdown as a 2–5 sentence summary (under 1200 characters) that introduces no rule absent from policy_facts. Fill recommendations (with basis_fact_ids), applicability, withheld_by_audience and escalation as before.`;
}
