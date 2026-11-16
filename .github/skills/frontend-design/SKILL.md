---
name: frontend-design
description: "Guidance for distinctive, intentional visual design when building new UI or reshaping an existing one. Use for frontend design, UI redesigns, visual direction, typography, layout, responsive polish, or making a web interface feel less templated."
license: "Complete terms in LICENSE.txt"
---

# Frontend Design

Act as the design lead for a studio that gives each product a deliberate visual identity. Produce interfaces that fit their subject matter and audience, not interchangeable layouts assembled from defaults.

## When to Use

Use this skill when:

- Building a new web interface, page, dashboard, tool, or application.
- Redesigning an existing frontend while preserving its behavior.
- Choosing a visual direction, palette, typography, spacing, layout, or motion system.
- Reviewing a UI for generic, templated, or visually incoherent choices.

## Workflow

### 1. Ground the brief

Identify the product's subject, audience, and primary job before choosing a visual style.

- If the brief names them, use those constraints directly.
- If the brief is vague, propose one concrete subject, audience, and primary job before implementation and confirm them when the choice affects the design materially.
- Read the existing frontend before editing. Preserve established design-system patterns unless the brief explicitly asks for a new direction.
- Find the smallest owning surface: the component, route, or stylesheet that controls the requested visual behavior.
- State one local design hypothesis and one cheap check that can disconfirm it before the first edit.

### 2. Make a compact design plan

Before writing code, define a small token system and an ASCII wireframe.

#### Color

Name 4-6 concrete colors with hex values. Include the role of each color:

- Base/background
- Surface or panel
- Primary text
- Muted text
- Accent/action
- Status or emphasis color when needed

Avoid palettes that are only one hue family. Do not default to purple-on-white, warm cream plus terracotta, near-black plus acid green, or dark dashboard blue unless the brief makes that direction appropriate.

#### Type

Choose typefaces deliberately and define their roles. Use one family or two clearly distinct families. Establish an intentional scale and weights. Avoid defaulting to Inter, Roboto, Arial, or a generic system stack when the design has freedom.

Keep normal line lengths below 80 characters. Use sentence case for user-facing copy unless the product language requires another convention. Avoid styling one word in a headline as a decorative accent.

#### Layout

Describe the composition in one sentence, then sketch it:

```text
[characteristic product signal]
[primary task or content]   [supporting context]
[secondary workflow / next useful state]
```

Specify alignment guidance: normally left-align dense operational content, center only when the experience is intentionally focused, and do not justify UI copy. Use stable dimensions for boards, controls, tiles, charts, and other fixed-format elements.

#### Principles

Write 3-5 principles that are specific to this brief. Spend boldness in one place and keep the rest disciplined. Structural elements such as dividers, numbering, borders, and labels must explain information or sequence rather than decorate it.

### 3. Review the plan before building

Challenge the plan before implementation:

- Would the same palette, type, and composition appear in an unrelated product?
- Is the memorable element earned by the subject matter?
- Does the first viewport show the product's real job or only marketing copy?
- Are headings, labels, and controls using plain language?
- Are repeated cards, rounded corners, shadows, gradients, and uppercase labels being used because they help, or because they are defaults?
- Is there one clear hierarchy instead of several competing focal points?

Revise any generic choice and briefly record what changed and why.

### 4. Build the interface

Implement the smallest coherent change that proves the direction.

- Reuse the project's framework, components, tokens, and helper APIs.
- Keep visual selectors scoped and check specificity when adding overrides.
- Make common workflows obvious and complete: loading, empty, success, error, disabled, hover, focus, and interaction states.
- Use familiar icons for icon-only controls and provide tooltips or accessible names for unfamiliar icons.
- Use real product imagery or meaningful visual assets when imagery is part of the brief. Do not use decorative blobs, generic stock-like hero media, or gradients as a substitute for content.
- Use motion sparingly. Prefer one page-load reveal or one state-change animation; honor `prefers-reduced-motion`.
- Keep text inside its container at desktop and mobile widths. Do not let dynamic content resize controls or cause overlap.
- Preserve keyboard focus visibility and sufficient color contrast.

### 5. Critique the rendered result

After the first substantive edit, run the narrowest available validation before continuing. Then render the page and inspect screenshots at desktop and mobile widths.

Check:

- The first viewport communicates the product and primary action immediately.
- The layout has no horizontal overflow, clipped text, or overlapping controls.
- The strongest visual choice is visible but not competing with the task.
- Dense operational screens support scanning, comparison, and repeated action.
- Responsive behavior is intentional rather than simply stacked.
- Empty and error states guide the next action.
- Focus rings, disabled states, and reduced motion remain usable.

Remove one unnecessary decorative treatment during this critique pass.

### 6. Finish and report

Run the project's build, lint, typecheck, and focused tests when available. Resolve regressions in the touched slice before expanding scope. Document newly implemented main features in the repository README when project instructions require it.

Report:

- The chosen visual direction and why it fits the subject.
- The files and behavior changed.
- The validation commands and their results.
- Any remaining visual or environment limitation.

## Writing Guidance

Interface copy is navigation, not decoration.

- Use active voice and concrete verbs: "Save changes" rather than "Submit."
- Keep the same action name through its whole lifecycle.
- Name things from the user's perspective, not the implementation's perspective.
- Treat empty states as invitations to act and errors as specific recovery instructions.
- Do not add visible text whose only purpose is to explain features, shortcuts, styling, or the design itself.

## Quality Bar

Do not call the work complete until:

- The visual direction is specific to the brief and survives the generic-default review.
- The main workflow is usable without relying on hover or color alone.
- Desktop and mobile layouts are both checked.
- The project has a focused executable validation result, or the limitation is explicitly reported.
- Existing behavior and unrelated user changes remain intact.
