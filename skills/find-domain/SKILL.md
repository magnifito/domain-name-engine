---
name: find-domain
description: Use when the user wants to find a brand name and domain end to end or continue a naming project. Coordinates a creative brief, diverse generation, availability checks, research, language review, and recommendations directly in chat.
---

# Find domain

Run each skill on the same saved project. The agent supplies creative judgment; the MCP server supplies stored evidence. A successful search finds names the user can identify with, not merely unregistered domains.

## Start or resume

Call `project_list`; use the project already named in the conversation, otherwise resolve which one to continue or create. For an existing project call `project_get`, read the current brief and feedback, and surface any recovery warning.

Choose the next step from the user's request and current evidence, not just old names or a report file. A request for better names returns to `generate`. Reassess an old shortlist against the current brief, feedback, and domain policy before continuing. A previous `report.md` does not prove that the current search is complete.

## Flow

1. **Brief.** Invoke `brief` with the supplied context. It prefills known facts and uses a short choice-first survey for missing preferences, preferably with the host's clickable question controls. Skip the survey for a complete brief. Preserve the emotional promise, references and rejection reasons, creative guidance, and domain policy. Continue when saved.
2. **Generate.** Invoke `generate`. Explore distinct territories and structures, judge before availability, and expand within a bounded search. Present a manageable, varied selection directly in chat; save the user's shortlist through `project_shortlist`. If nothing compelling survives, stop and calibrate.
3. **Research.** Invoke `research` for eligible shortlisted names. Each needs allowed-domain evidence, trademark and competitor checks, and handles only when requested. Profiles for registered primary-TLD domains are required only when `domainPolicy.includeRegistered` is true. Check each research kind independently; a trademark result alone does not prove research is complete.
4. **Language.** Invoke `language-check` for the shortlist and target languages, including English. Explain serious issues and revisit the shortlist rather than hide a risk.
5. **Recommend.** Invoke `report` to refresh registrar evidence and compare worthy finalists directly in chat. A file is optional, only when requested. If checks eliminate the whole shortlist, say so and offer a changed creative direction; do not rank rejected names to fill the answer.

Confirm the brief and let the user choose the shortlist, honoring decisions already made in the conversation. Announce stages briefly; do not add approval gates to routine checks. Summarize intermediate research rather than printing a full dossier at every step.

## Output and evidence

- Lead with up to six worthwhile names, exact domains, natural associations, reasons to choose them, main weaknesses, and dated check evidence. Explain meaningful tradeoffs. No mandatory score table or file path.
- Keep registered domains, failed checks, and fallback spellings out of recommendations unless explicitly requested. Preserve their results internally. Exact-domain constraints apply at every stage.
- Distinguish a registry no-record signal, preliminary `likely_available`, and live registrar-confirmed purchase availability. Unknown stays unknown; table prices and DNS absence do not confirm availability.
- Follow `report` price rules: source and date, first-year and renewal together, no mixing currencies, no guessed values.
- Domain availability is separate from trademark clearance and existing brand use. No urgency copy or emoji.
- If a tool or skill fails, name the gap and continue independent work. Never treat a missing check as successful.
- No report file, HTML page, or visual review surface unless requested. Internal project persistence remains part of the workflow.

End with the recommendation and limits, or an honest no-fit result and one useful calibration question. A completed turn needs no `report.md`.
