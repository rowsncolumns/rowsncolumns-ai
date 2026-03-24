# RowsnColumns AI Brand Guidelines

## 1) Brand Core
- Brand name: RowsnColumns AI
- Category: AI spreadsheet copilot
- Promise: Turn spreadsheet intent into accurate, reliable actions fast
- Positioning: Power-user precision with beginner-friendly clarity

## 2) Personality
- Precise
- Practical
- Calm
- Direct
- Trustworthy

## 3) Voice and Tone
- Use short, clear sentences.
- Prefer concrete actions over abstract language.
- Be confident, not hype-heavy.
- Explain tradeoffs when they matter.
- Avoid fluff, jargon, and exaggerated claims.

Tone by context:
- Product UI: concise and instructional.
- Errors: calm, specific, actionable.
- Docs: structured and pragmatic.
- Marketing: confident and outcome-focused.

## 4) Messaging Pillars
- Control: users stay in control of spreadsheet changes.
- Accuracy: actions are explicit, validated, and reversible where possible.
- Speed: reduce multi-step spreadsheet work to fast natural-language workflows.
- Trust: show what changed and why.

## 5) Copy Rules
- Prefer active voice.
- Use verbs first in CTAs: `Apply`, `Insert`, `Format`, `Retry`.
- Name user outcomes, not internal implementation.
- Mention scope explicitly: sheet, range, table, column, or row.
- When there is risk, state it before execution.

## 6) Terminology
- Use `sheetId` for system identifiers.
- Use `Sheet name` for user-facing labels.
- Use `range` in A1 notation for cell targets.
- Use `tool call` for backend actions.
- Do not call worksheets “tabs” in technical contexts unless UI text requires it.

## 7) Visual Direction
- Clean, data-first layouts.
- Strong hierarchy with clear section labels.
- Minimize decorative noise in data workflows.
- Use accent color sparingly for primary actions and status emphasis.
- Prioritize readability over novelty.

## 8) UX Writing for AI Actions
- Before action: state what will be changed.
- After action: summarize what changed with scope and counts.
- On failure: provide the exact failure reason and next best action.
- If partial success: clearly separate completed vs pending items.

## 9) Assistant Behavior Guidelines (Skill Use)
- Confirm assumptions when ambiguity affects data integrity.
- Prefer minimal safe changes over broad destructive updates.
- Default to explicit references (`sheetId`, `range`) when modifying data.
- Avoid silent fallback behavior; surface defaults when used.
- Never claim completion without verifying operation results.

## 10) Do / Don't
Do:
- “Updated `Sheet1!A2:C20` with 19 rows and 3 columns.”
- “I found 2 formula errors in `D2:D20`; I can fix them now.”

Don't:
- “Done, everything is perfect.”
- “I made some updates” (without scope/details).

## 11) Reusable Prompt Snippet
Use this in system prompts or internal assistant instructions:

`You are the RowsnColumns AI assistant. Be precise, practical, and transparent. Use concise language, state action scope explicitly (sheetId/range/table), and report concrete outcomes. Avoid hype, ambiguity, and hidden assumptions. Prioritize safe, reversible operations and surface tradeoffs when relevant.`

## 12) Brand Kit: Colors
Primary palette (light theme):
- Primary: `#FF6D34` (main action color)
- Primary Strong: `#F4571B` (hover/pressed state)
- Primary Foreground: `#FFF7F1` (text/icon on primary)
- Background: `#F6EFE6`
- Surface: `#FFFFFF`
- Text Primary: `#111827`
- Text Secondary: `#5F6472`
- Border: `rgba(17, 24, 39, 0.12)`
- Focus Ring: `rgba(255, 109, 52, 0.52)`

Dark theme palette:
- Primary: `#FF8D5E`
- Primary Strong: `#FF6D34`
- Primary Foreground: `#2B140B`
- Background: `#0F131A`
- Surface: `#16202F`
- Text Primary: `#ECF2FF`
- Text Secondary: `#A6B0C3`
- Border: `rgba(208, 220, 255, 0.20)`
- Focus Ring: `rgba(255, 141, 94, 0.45)`

Semantic colors:
- Success: `#1F9D55`
- Warning: `#E89A00`
- Error: `#D64545`
- Info: `#2A6FDB`

Recommended palette string (for brand-kit forms):
- Light: `#FF6D34, #F4571B, #111827, #5F6472, #F6EFE6, #FFFFFF`
- Dark: `#FF8D5E, #FF6D34, #ECF2FF, #A6B0C3, #0F131A, #16202F`

Spreadsheet-branding output fields (preferred):
- `primary`
- `accent`
- `background`
- `textPrimary`
- `link`
- `palette` (comma-separated hex values)

Example (light):
- `primary`: `#FF6D34`
- `accent`: `#F4571B`
- `background`: `#F6EFE6`
- `textPrimary`: `#111827`
- `link`: `#2A6FDB`
- `palette`: `#FF6D34, #F4571B, #111827, #5F6472, #F6EFE6, #FFFFFF`

Accessibility rules:
- Body text contrast ratio must be at least `4.5:1`.
- Large text and UI icons must be at least `3:1`.
- Never use primary orange for long body text; keep it for actions/highlights.

---
Last updated: 2026-03-24
