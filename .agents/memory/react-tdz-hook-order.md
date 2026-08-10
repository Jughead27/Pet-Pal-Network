---
name: React TDZ in long components
description: const variables used by hooks or derived state must appear BEFORE the line that references them; TypeScript silently allows out-of-order references that crash at runtime.
---

# React TDZ in long function components

## The rule
In a React function component, every `const` variable must be declared **before** any line that reads it. JavaScript's temporal dead zone (TDZ) enforces this at runtime but TypeScript does not catch it at compile time.

**Why:** TypeScript only checks type compatibility; it does not enforce declaration order within a function body. A variable used at line 231 but declared at line 573 compiles cleanly but throws `ReferenceError: Cannot access 'X' before initialization` the moment the component renders.

**How to apply:** When adding new hooks or derived values to a large component, check that any existing variable they depend on is already declared earlier in the function. If not, either move the existing declaration up (using optional chaining if needed to handle loading states) or restructure so the dependency is computed without the problematic variable.

## Concrete case
`pet/[id].tsx` — `editTagExclude` at line 231 referenced `selectedPost`, which was declared at line 573. Fix: moved `selectedPost` to line 232, using `pet?.posts ?? []` (optional chaining) so it is safe even when `pet` is still loading. Removed the duplicate declaration that had been at line 573.

The symptom was Expo Router's error boundary showing "Something went wrong / Please reload the app to continue" for **every** navigation to the pet profile screen, regardless of data state.

## Variant: hooks declared below early returns
Same "something went wrong" symptom, different mechanism. Adding `useState` next to the *data derivation* it feeds — instead of next to the other hooks — placed it below `if (loading) return …` early returns. Hook count then changes on the loading→loaded transition → React throws "Rendered more hooks than during the previous render" on every load, for every user. TypeScript does not catch this either.

**How to apply:** in large screens with early returns, all new hooks go in the hook block at the top of the component; only derived (non-hook) values may live below the returns.
