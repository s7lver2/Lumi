# Setup "Credenciales" step — make Google Maps key optional — Design

## Context

`apps/web/app/setup/steps/CredentialsStep.tsx` marks `GOOGLE_MAPS_API_KEY` as "· obligatoria" and only calls `onComplete()` once the key is entered and passes `POST /api/setup/test-key` — blocking the whole setup wizard on a real, validated Google Cloud key. In practice this key is only needed for capturing new areas via Street View; someone who only wants to browse/install datasets already published to the catalog doesn't need it at all. Today's design forces them to get one anyway.

## What changes

The key becomes optional. A new checkbox, "Tengo cuenta en Google Cloud Console y quiero configurarla ahora", gates whether the input is even shown:

- **Unchecked (default):** the API key input is hidden. The step is complete without it — `onComplete()` fires with no key requirement at all.
- **Checked:** the input (and its existing "Probar" button/flow) appears. Leaving it empty after revealing it still doesn't block anything — the key remains optional in that case too.
- **Checked AND something typed into the field:** must pass `POST /api/setup/test-key` before the step can complete — identical validation flow to today, just no longer force-shown or force-required from the start.

So the only real gate left is: *if there's non-empty text in the key field, it must validate.* Empty (whether hidden or revealed-but-empty) never blocks.

## Completion logic

Today, `onComplete()` is called only inside `test()`'s success branch. Since completion is no longer solely test-gated, it needs to be reactive to the field's state:

```ts
const [showGoogleKey, setShowGoogleKey] = useState(false);
const [testing, setTesting] = useState(false);
const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
const google = values.GOOGLE_MAPS_API_KEY ?? "";

useEffect(() => {
  if (google === "" || result?.ok === true) onComplete();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [google, result]);
```

`test()` keeps its current shape (call `/api/setup/test-key`, set `result`), just without directly calling `onComplete()` itself — the effect above reacts to `result` changing instead, keeping the two concerns (running the test, deciding completion) separate. Typing into the field after a successful test invalidates the previous result (existing `onChange` handler already does `setResult(null)` — unchanged), which correctly un-completes the step until either the field is cleared again or a new test passes.

## UI

```
Credenciales
Se guardan cifradas y se aplican al terminar. Nada se escribe hasta confirmar.

☐ Tengo cuenta en Google Cloud Console y quiero configurarla ahora
   La clave de Google Street View Static API solo hace falta si vas a capturar tus propias
   áreas — no es necesaria para instalar datasets ya publicados. Podrás añadirla más tarde
   desde Ajustes si cambias de idea.

  (checkbox checked reveals, in place of the blurb:)
  Google Street View Static API key
  [___________________] [Probar]
  ✓ Clave válida · Street View respondió OK

Mapbox token · opcional
[...]
```

The `MAPBOX_TOKEN` field and the `LIMITS` grid (`MAX_AREA_KM2`, `MAX_MONTHLY_BUDGET_USD`, etc.) are unchanged — this redesign only touches the Google Maps key's requirement and visibility.

## Testing

This step has no existing test file (matches this codebase's convention: setup step components with only DOM/interaction logic, no pure-function core, are verified manually rather than unit-tested — same as `CredentialsStep.tsx` today, `SystemPanel.tsx`, `ModelosSection.tsx`). Verify manually in the browser:

1. Load the Credenciales step fresh — checkbox unchecked, key input hidden, "Siguiente" already enabled (no key required).
2. Check the box — input appears, "Siguiente" stays enabled (still empty).
3. Type an invalid key, click "Probar" — fails, "Siguiente" becomes disabled while `result.ok !== true` and the field is non-empty.
4. Type a valid key, click "Probar" — passes, "Siguiente" re-enables.
5. Clear the field entirely after a passing test — "Siguiente" stays enabled (empty is always fine).
6. Uncheck the box after entering a key — confirm the field's value in `collected` state is left as-is (unchecking only hides the input, it doesn't clear what was typed) and the step is still complete either way.

## Global Constraints

- The only blocking condition is "non-empty key text that hasn't passed validation" — never "checkbox is checked" by itself, and never "key is empty" by itself.
- `MAPBOX_TOKEN` and the `LIMITS` fields keep their current behavior untouched.
