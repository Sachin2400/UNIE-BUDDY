# UNIE Buddy Development Rules

This is a TanStack Start + React + TypeScript + Supabase project.

Project location:
C:\Users\sachi\Downloads\unie-buddy-main-fixed_2\unie-buddy-main

## Before making changes

1. Inspect the relevant existing files first.
2. Understand the existing implementation and data flow.
3. Do not rewrite unrelated code.
4. Do not replace working functionality just to simplify the code.
5. Preserve existing Supabase queries, server functions, routes, and authentication unless the requested change requires modifying them.
6. Do not modify generated route files such as routeTree.gen.ts unless explicitly required.
7. Do not expose or modify API keys in .env.
8. Prefer the smallest safe change that accomplishes the requested feature.

## Validation

After code changes:

1. Run:
   npx tsc --noEmit

2. If TypeScript passes, report that clearly.

3. Do not claim that functionality was tested in the browser unless it was actually tested.

## Important existing functionality

The Upload page handles newspaper PDF uploads.

The newspaper pipeline includes:
PDF upload → Supabase Storage → newspaper processing → OCR/PDF extraction → article extraction → MCQ generation.

The Practice Set route is:

/playground/$newspaperId

The Playground loads the existing newspaper-wide MCQ pool through:

getNewspaperMcqPool({ newspaperId })

Do not replace this with article-level MCQ loading.

The Playground currently supports:
- existing newspaper-wide MCQ practice
- answer checking
- explanations
- Match-the-Following rendering
- Export All MCQs as PDF

PDF export must use the existing generated MCQ pool and must not call AI to generate new questions.

## Coding preference

Use TypeScript and existing project patterns.

Before editing a file, show/explain:
- which file will change
- what section will change
- why the change is needed

For risky or broad changes, inspect first and propose the change before applying it.

Do not make large architectural changes when a local fix is sufficient.