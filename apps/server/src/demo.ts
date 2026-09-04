import type { DemoTask } from '@westline/shared';

/** PRD §14. The two workflows the video shows; also what `scripts/demo.sh` runs. `a|b` in expected_tools means either satisfies. */
export const DEMO_TASKS: DemoTask[] = [
  {
    id: 'task-1-creator-drone',
    title: 'Creator partner: sponsored-shoot expense and disclosure',
    acting_person_id: 'W-3010',
    message: 'I bought a drone for the sponsored Big White shoot next month. Can I expense it, and does the sponsor tag need to be disclosed on the video?',
    expected_tools: ['hr__lookup_person_profile', 'policy__get_policy_applicability', 'policy__search_policy_documents', 'policy__get_policy_section|policy__check_policy_compliance'],
  },
  {
    id: 'task-2-pto-draft',
    title: 'Staff: PTO request with a gated draft to the manager',
    acting_person_id: 'W-1042',
    message: 'Can I take Oct 14–16 off? If it works, draft the note to Priya.',
    expected_tools: ['hr__lookup_person_profile', 'hr__check_pto_balance', 'policy__search_policy_documents|policy__get_policy_section', 'hr__draft_hr_email'],
  },
];
