# NutriTrack

NutriTrack is a React 19 + TypeScript app built with Vite and Tailwind CSS v4. The frontend lives in `src/`; the mock wearable REST API lives in `backend/`.

## Running the app

- Install frontend dependencies from the repository root with `pnpm install`.
- Start the frontend with `pnpm dev` (port 8443 by default).
- Start the wearable API in a separate terminal with `pnpm --dir backend install` and `pnpm --dir backend dev` (port 3001 by default).
- Build the frontend with `pnpm build`.

## Project structure

- `src/main.tsx` mounts `src/App.tsx` and imports the global stylesheet.
- `src/App.tsx` contains the application screens and UI.
- `src/data/mockData.ts` contains mock meal and nutrition data.
- `src/services/wearableService.ts` calls the wearable API.
- `src/index.css` contains global styles and Tailwind CSS v4 setup.
- `backend/server.js` implements the mock wearable API.
- `index.html` is the Vite HTML shell.
- `vite.config.ts` configures Vite, React, Tailwind, and the `@` alias for `src`.

## Styling and code quality

- Use Tailwind utility classes in JSX and put global CSS or Tailwind theme customization in `src/index.css`.
- Keep global element styles inside `@layer base` so Tailwind utilities can override them.
- Use double quotes for strings containing apostrophes, or escape apostrophes in single-quoted strings.
- Keep JSX tags closed and braces balanced.
- Export components as default exports.
