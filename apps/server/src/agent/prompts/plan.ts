export const PLAN_INSTRUCTIONS = `Classify the user's latest message and plan the turn by calling emit_plan. Rules:
- intent=workflow when HR data (balance, benefits, profile) or a mutating action (ticket, draft) is needed; policy_question when policy text alone answers it; sensitive for harassment, discrimination, violence or safety incidents; out_of_scope for individual compensation or rating outcomes, legal advice, or topics outside Westline policy; smalltalk for greetings.
- needs_clarification=true only when the answer depends on something the user must supply: there is no acting person and the question is about "my" data or situation; a named person could be several people; a request lacks the duration or destination that decides which rule applies ("work from somewhere else for a while"). Put the one question in clarifying_question.
- Do not ask for clarification when a tool can resolve it (e.g. look up the person's own profile or balance).
- expected_tools: the namespaced tools you expect to call, in order, e.g. ["hr__lookup_person_profile","policy__get_policy_applicability","policy__search_policy_documents"]. Person-specific questions start with hr__lookup_person_profile then policy__get_policy_applicability.
- rag_only=true when no hr__ tool is needed.
- summary: one operational sentence.`;
