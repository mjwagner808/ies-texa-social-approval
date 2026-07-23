# Deployment Checklist - IES-TEXA Social Media Approval App

Read this every time before ending a work session on this app, and after any code change made directly in the Apps Script editor.

## The rule

Saving a file in the Apps Script editor does nothing to what is live. The web app only updates when a deployment is pushed through Manage Deployments. A saved-but-not-deployed change is invisible in production no matter how many times it is re-saved or re-tested with the Run button.

## Every time code changes

1. Save each changed file in the Apps Script editor.
2. Deploy, Manage Deployments, click the pencil icon on the existing deployment, change the version to New version, Deploy. Never use "New deployment," that creates a second URL and breaks every existing client link.
3. Confirm the version number in the deployments list actually changed.
4. Re-test the specific thing that changed against the live URL, not just the editor's Run button. Run-button testing confirms the code works, not that it is live.
5. If the change touches anything client-facing (ClientPortal.html, any `api_client*` function), test it from an incognito window using a real token, not from an agency-logged-in session.

## Why this exists

On 2026-07-23, a real privacy leak (Corporate could see Local's review conversation) went unfixed for most of a day because three separate code changes were saved but never deployed. Every "fix" made during that window was invisible in production the whole time. Full incident in the 2026-07-23 entry of `session-log.md`.

## Known gotcha (same incident)

Functions ending in a trailing underscore are hidden from the Apps Script editor's Run dropdown, this is private-by-convention, not a bug. If a manual-run debug helper is added, give it a name without a trailing underscore or it will not appear in the dropdown.
