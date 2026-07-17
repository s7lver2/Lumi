// apps/web/app/lib/publish-wizard-steps.ts

/** Step 1 (choose area) only advances once an area is actually selected. */
export function canAdvanceFromAreaStep(selectedAreaId: string | null): boolean {
  return selectedAreaId !== null && selectedAreaId !== "";
}

/** Step 2 (details) requires at least a non-blank title — description stays optional. */
export function canAdvanceFromDetailsStep(title: string): boolean {
  return title.trim().length > 0;
}

/** Step 3 (destination) requires an "owner/repo"-shaped value and the ToS checkbox. */
export function canPublish(repo: string, tosAccepted: boolean): boolean {
  return tosAccepted && /^[^/\s]+\/[^/\s]+$/.test(repo.trim());
}
