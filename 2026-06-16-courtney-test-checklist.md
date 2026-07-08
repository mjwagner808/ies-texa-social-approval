# IES-TEXA App — Courtney Test Checklist

**Date:** June 16, 2026  
**Testers:** MJ (agency) + Courtney (agency + stand-in client)  
**Goal:** Walk the full approval workflow end to end before Ali goes live.

---

## Before You Start

- [ ] MJ has the agency portal open: the `/exec` URL (signed in as mj.wagner@finnpartners.com)
- [ ] Courtney has the agency portal open: same URL (signed in as courtney.kiehm@finnpartners.com)
- [ ] MJ has the local client portal URL ready: `[APP_URL]?page=client&token=[local token]`
- [ ] MJ has the corporate portal URL ready: `[APP_URL]?page=client&token=[corporate token]`
- [ ] All three of you (MJ, Courtney, Jackie) can receive email at your @finnpartners.com addresses

---

## Phase 1 — Create a Test Post (MJ)

- [ ] Click **+** (bottom right of calendar)
- [ ] Fill in:
  - Title: `TEST — June checklist`
  - Post Copy: any text
  - Platform: Facebook, Instagram
  - Scheduled Date: today or tomorrow
- [ ] Click **Save post** — panel should close automatically
- [ ] Verify: post appears on calendar as gray **Draft** badge

---

## Phase 2 — Send to Local Client (MJ)

- [ ] Open the test post → change Status to **Local Client Review** → Save post
- [ ] Verify: orange **"⚠️ X ready — send to Local!"** badge appears in toolbar
- [ ] Click **Send to Local Client**
- [ ] Verify: badge disappears and shows green "✓ All caught up"
- [ ] Verify: Courtney and Jackie receive the digest email from anthologysocial@finnpartners.com (subject: "[IES-TEXA] 1 post ready for your review")

---

## Phase 3 — Local Client Reviews (MJ opens local portal)

Open the local client portal URL as if you're Ali.

**Test 3a — Request Changes:**
- [ ] Click the test post → type a change request note → click **Request Changes**
- [ ] Verify: post badge on agency calendar changes to teal **Revising**
- [ ] Verify: MJ, Courtney, and Jackie all receive the agency notification email

**Test 3b — Agency Revises:**
- [ ] MJ opens the post in agency portal → edits Post Copy → saves
- [ ] Change status back to **Local Client Review** → save → click **Send to Local Client**

**Test 3c — Approve:**
- [ ] Open local portal again → click **Approve**
- [ ] Verify: post badge changes to indigo **Send to Corporate**
- [ ] Verify: MJ, Courtney, and Jackie receive agency notification email

---

## Phase 4 — Send to Corporate (MJ or Courtney)

Either portal can initiate this step — test from the agency side first.

- [ ] Verify: indigo **"⚠️ X ready — send to Corporate!"** badge in toolbar
- [ ] Click **Send to Corporate**
- [ ] Verify: badge disappears, post status changes to purple **Corporate Review**
- [ ] Verify: agency receives FYI email that posts were sent to corporate

---

## Phase 5 — Corporate Reviews (MJ opens corporate portal)

Open the corporate portal URL as if you're the corporate approver.

**Test 5a — Approve:**
- [ ] Click the test post → click **Approve**
- [ ] Verify: purple **"⚠️ X ready — send responses!"** badge appears in toolbar
- [ ] Click **Send Responses**
- [ ] Verify: badge disappears, green "✓ All caught up" confirmation
- [ ] Verify: MJ/Courtney/Jackie receive the corporate batch results email
- [ ] Verify: local client portal shows post as green **Approved**

**Test 5b (optional) — Request Changes from Corporate:**
- [ ] Create a second test post, run it through to Corporate Review
- [ ] In corporate portal: leave a note → click **Request Changes** → Send Responses
- [ ] Verify: post returns to teal **Revising** on agency calendar
- [ ] MJ revises → clicks **Re-send to Corporate** toolbar button
- [ ] Verify: post returns to **Corporate Review**, corporate receives email

---

## Phase 6 — Mark Published (MJ)

- [ ] Verify the approved test post shows a **Mark Published →** button on the agency calendar card
- [ ] Click it
- [ ] Verify: post badge changes to dark green **Published**

---

## Phase 7 — Notifications Check

Confirm all three of you received emails at the right moments:

| Trigger | Who gets email |
|---------|---------------|
| Agency sends to Local | Local client (Ali / test portal) |
| Local approves or requests changes | MJ, Courtney, Jackie |
| Agency or local sends to Corporate | Corporate portal user; agency gets FYI |
| Corporate sends batch responses | Local client + MJ, Courtney, Jackie |

---

## Known Issues / Notes

- If you see "Too many simultaneous invocations" — wait 10 seconds and try again. This was patched but may still appear occasionally under heavy load.
- Toolbar badges auto-refresh every 30 seconds. If a badge doesn't appear immediately after a client action, wait up to 30 seconds or reload the page.
- All emails come FROM anthologysocial@finnpartners.com. If you don't see them in your inbox, check Junk.
- The local and corporate test portal URLs use Access_Tokens set up in the Authorized_Clients sheet. Confirm those are active before testing.
