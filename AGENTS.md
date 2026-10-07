# Development Guidelines — React / TypeScript / Express

Follow these rules when writing, modifying, or reviewing code.
Respect explicit user instructions and project-specific requirements.

## Project Context and Skills

- Before starting, read the applicable AGENTS.md files, package.json,
  and relevant configuration files.
- Review the affected code, project structure, and existing patterns
  before introducing a new approach.
- Review the names and descriptions of skills in the applicable
  .agents/skills directories. Include other skill directories under
  .agents if the project explicitly identifies them.
- Read the SKILL.md files of relevant skills and follow their applicable
  references and instructions.
- Do not load every skill indiscriminately.
- For React development, use vercel-react-best-practices if installed.
  Apply Next.js-specific rules only to Next.js projects.
- Report missing or unreadable required skills.
  Do not claim to have used a skill you have not read.

## TypeScript and Type Safety

- Use TypeScript for new application code.
  Use .tsx files for React components.
- Migrate existing JavaScript only where justified by the current task.
- Avoid any and implicit any.
- Treat unknown external data as unknown, then validate or narrow it.
- Avoid unjustified type assertions and non-null assertions.
- Do not hide errors with @ts-ignore or @ts-nocheck.
- Do not weaken TypeScript or lint rules to make incorrect code pass.
- Use type inference where it improves clarity.
  Keep public module contracts explicit.
- TypeScript types do not provide runtime validation.
  Validate external inputs at runtime.

## Consistent Type Declarations

- Follow the project's established convention for type and interface.
  Do not alternate between them arbitrarily for equivalent declarations.
- If there is no established convention, prefer type aliases for new
  application types and use them consistently.
- Use interface when a specific requirement justifies it, such as
  intentional declaration merging or an extensible public contract.
  Keep such exceptions deliberate and consistent.
- Do not rewrite unrelated existing declarations solely to enforce
  a preferred style.
- Use utility types such as Pick, Omit, Partial, Required, Readonly,
  Record, Extract, Exclude, and ReturnType when they express the intended
  relationship clearly and reduce duplication.
- Do not use Partial indiscriminately when only specific fields
  should be optional or editable.
- Use unions to represent valid alternatives and discriminated unions
  for states or variants with different required properties.
- Prefer explicit valid states over collections of optional properties
  that allow invalid combinations.
- Use intersections and generics when they improve reuse and accurately
  express the contract.
- Avoid overly complex type manipulation when a straightforward
  declaration is easier to understand.
- Reuse domain types where their meaning is genuinely shared.
  Keep API, persistence, and domain types separate when their contracts
  differ.

## Naming, Formatting, and Readability

- Use descriptive, consistent English identifiers.
  Follow the project's established terminology.
- Use camelCase for variables and functions.
- Use PascalCase for components, classes, and types.
- Prefix hooks with use.
- Use clear is/has/can/should names for boolean values where natural.
- Follow existing file naming conventions.
- Avoid vague names and unnecessary abbreviations.
- Follow the existing ESLint and formatting configuration.
- Do not reformat files unrelated to the task.
- Prefer straightforward control flow and early returns.
  Avoid deeply nested logic.
- Comments should explain reasoning, constraints, or non-obvious behavior,
  rather than repeat the code.

## Clean Code and Modularity

- Each function should have one clearly defined responsibility.
- Each component and module should have a cohesive purpose.
- Avoid large, monolithic files.
  Split code by responsibility rather than arbitrary line limits.
- Do not fragment code into unnecessary tiny modules.
- Separate presentation, business logic, data access,
  and external integrations.
- Place replaceable infrastructure behind narrow interfaces or adapters
  at appropriate module boundaries.
- Do not leak provider-specific SDKs into domain logic or UI components.
- Use explicit dependency injection where it improves replaceability
  and testability.
- Avoid redundant code. Extract genuinely shared behavior.
- Do not introduce overly general abstractions merely because code
  fragments look similar.
- Do not build speculative features, unused helpers,
  or unnecessary architectural layers.
- Avoid hidden side effects, circular imports,
  and shared mutable global state.

## React

- Use functional components and follow the Rules of Hooks.
- Keep components focused.
  Extract complex, reusable logic into custom hooks when justified.
- Keep rendering pure: do not mutate props or state,
  or initiate side effects during rendering.
- Calculate derived values during rendering where practical.
  Avoid redundant state and effects for derived data.
- Keep effect dependencies correct.
  Implement cleanup where necessary.
- Use stable list keys. Do not use array indexes for lists
  whose order or contents can change.
- Handle loading, error, empty, and success states.
- Handle asynchronous race conditions and stale results.
- Use semantic HTML, accessible controls, labels,
  and appropriate keyboard interactions.
- Do not add useMemo, useCallback, or React.memo automatically.
  Each optimization should have a concrete justification.
- Follow the project's existing data-fetching
  and state-management approach.

## Express and APIs

- Keep HTTP handling in routes/controllers.
  Separate business logic and data access in a way appropriate
  to the task's complexity.
- Validate params, query, and body data at system boundaries.
  Use the existing validation approach.
- Treat authentication and authorization as separate concerns.
- A user ID or role supplied by the client is not proof of authorization.
- Use consistent API responses, appropriate HTTP status codes,
  and centralized error handling.
- Forward asynchronous errors according to the installed Express version.
- Do not expose internal stack traces or secrets to clients.
- Do not log passwords, tokens, or sensitive personal data.
- Use parameterized database queries.
- Use transactions where related data changes must succeed or fail together.
- Avoid blocking synchronous I/O in request handlers.
- Implement appropriate timeouts and error handling for external calls.

## Dependencies and Scope

- Prefer existing code, dependencies, and platform capabilities first.
- Add runtime or development dependencies only when justified
  and explicitly approved by the user in advance.
- When requesting approval, explain the dependency's purpose,
  available alternatives, and expected impact.
- Do not request approval again for a dependency
  the user has already explicitly authorized.
- Do not change unrelated package versions.
  Follow the existing package manager and lockfile.
- Complete the task fully while avoiding unrelated refactoring.
- Preserve the user's existing changes.
- Do not put secrets in source code or version-controlled configuration.
- Update .env.example when necessary, without including real secrets.
- Identify breaking changes in advance and provide appropriate migrations
  or documentation.

## Checks and Tests

- After each completed unit of code changes, and before finishing,
  run the available and relevant checks:
  lint, typecheck, unit/integration tests, and build or E2E tests
  when necessary.
- Select commands from package.json, project documentation, and CI.
  Do not invent scripts that do not exist.
- Check the affected area first, then run additional checks
  required by the project.
- When changes affect both frontend and backend,
  verify both affected packages.
- Add meaningful tests for new or changed business behavior
  using the existing test framework.
- Add regression tests for bug fixes where practical.
- Test expected behavior, including relevant invalid inputs
  and edge cases.
- Do not delete tests, weaken assertions, or disable checks
  merely to obtain a passing result.
- If a check cannot run, explain why and identify
  what remains unverified.
- Adding a new testing dependency also requires prior approval.

## Failed Checks and Retry Policy

- After the first failed check, investigate the cause.
  Distinguish errors introduced by your changes from pre-existing
  and environmental failures.
- Fix errors caused by your changes, then rerun the failed checks
  and any checks affected by the fix.
- Perform at most three fix-and-rerun cycles after the initial failure
  for the same failure sequence.
  This allows at most four verification rounds in total.
- Do not reset the retry count by renaming the same problem.
- If the failure persists after the third fix-and-rerun cycle,
  stop automatically attempting to fix that problem and inform the user.
- Report the failed command, relevant error message,
  attempted fixes, and recommended next step.
- Report missing access, configuration, services,
  or required permissions immediately.
  Do not repeatedly run an unchanged command that is certain to fail.
- Report unrelated pre-existing failures.
  Do not silently fix them outside the task's scope.
- Do not describe work as fully verified while required checks fail.

## Completion

- Review the final diff for accidental changes, debugging code,
  unused imports, and exposed secrets.
- Update relevant documentation when usage, configuration,
  or public contracts change.
- In the final response, briefly explain:
    - what changed and why;
    - which checks ran and their results;
    - what remains unverified, uncertain, or blocked.
- Distinguish executed checks from code inspection.
- Never claim tests passed without running them.
