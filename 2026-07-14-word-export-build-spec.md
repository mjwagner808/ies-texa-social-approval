# Build Spec: Reviewer Word Download (Record of Record)

**Client:** IES-TEXA (Island Energy Services, Texaco licensee)
**App:** IES-TEXA Social Media Approval Tool (Google Apps Script)
**Author:** MJ Wagner
**Date:** July 14, 2026
**Status:** Draft for approval. No code changes until MJ signs off.

---

## 1. Why we are building this

Ali Tanigawa (local reviewer) and IES Corporate need a downloadable record that captures a post from first submission through final approval, including every comment, change request, response, and approval along the way. This exists to replace the function Chevron's own portal serves: a defensible record of what was submitted, what changed, who reviewed it, and what was ultimately approved.

The download is a point-in-time snapshot. A reviewer can pull it at any stage. Pulled early, it simply shows less activity, which is why every document is date and time stamped.

### What each of Ali's four questions this resolves

| Ali's question | Resolved by this build? | How |
|---|---|---|
| Q1. A record of all assets submitted, reviewed, approved | Yes | The document is that record. |
| Q3. Downloadable calendar with comments and the final version | Yes | Direct deliverable. |
| Q4. Different versions along the way, and who made the changes | Yes | Version snapshots at each submit-to-review, plus the named, timestamped change and approval trail. |
| Q2. Is the note field the only way to comment? | Handled outside this build | MJ answers verbally. The note field is the commenting method and is sufficient. If Corporate insists on returning comments by Word, the agency enters those changes with a note crediting Corporate. |

Privacy note surfaced during scoping: the local reviewer's conversation with the agency must stay local. See Section 11 for the governing rule and the current-behavior fix.

Out of scope: inline or anchored commenting (pinning a note to a spot on an image or a specific word). Not required.

---

## 2. Who can download it, and where the button lives

| Role | Access | Button location |
|---|---|---|
| Local reviewer (Ali) | Posts shared with her | In the client portal |
| Corporate reviewer | Posts shared with Corporate | In the client portal |
| Agency (MJ, Courtney) | All posts (existing export already covers this) | Agency panel, as today |

The reviewer download is a new, token-scoped endpoint modeled on the current `api_exportCalendarToDocx`, but filtered to that reviewer and to client-visible content only.

---

## 3. What content each reviewer sees

Only posts that have actually been shared with that reviewer, meaning posts that reached that reviewer's stage. Posts still in internal drafting never appear. Internal comments and internal notes never appear.

Governing rule for comments: **Corporate sees only the Corporate conversation and never the local thread.** The local reviewer (Ali), as the liaison who deals with Corporate most, sees both the Local and Corporate conversations. The agency sees everything. Full detail in Section 11.

---

## 4. Document structure

### Cover / header
- Title: IES-TEXA Social Media Approval Record
- Client name and reviewer name
- Date range covered
- Generated on: date and time in HST
- Plain-language line: "This is a point-in-time snapshot generated on [date/time]. Activity after this time is not included."

### Per post, in date order
1. **Post identity:** title, platform(s), scheduled date, current status.
2. **Original submitted version:** the copy and media as first sent for review. Media shown as a preview rendered from the link at generation time.
3. **Review and change trail, in chronological order, scoped to that reviewer's conversation (Section 11):**
   - Each change request: who requested it, when, and the requested change text.
   - Each agency response: who replied, when, and the reply text.
   - Each approval: who approved, which tier (local or corporate), and when. Approvals themselves (who and when at each tier) appear in every reviewer's record, since they are facts of record, not conversation. Only the comment text is conversation-scoped.

   The local reviewer's download shows both the Local and Corporate conversations. Corporate's download shows only the Corporate conversation plus any note the agency deliberately wrote for Corporate, never the local thread. The agency download shows all conversations.
4. **Resubmitted versions (if any):** each version that was re-sent for review after changes, so the reader can follow the progression.
5. **Final approved or published version:** copy plus the media, embedded from the permanently saved copy (see Section 6), so the final asset is always present even if the original link later breaks.

Every entry carries its own timestamp, drawn from existing `Created_Date` fields.

---

## 5. Snapshot rules (the one genuinely new capability)

- **Trigger:** capture a snapshot of the creative each time a post is submitted to a reviewer, meaning each time its status enters a review state. This one rule yields the original, any resubmissions, and the final, and it skips internal drafts that were never shared.
- **What a snapshot stores:** the copy text plus the media links. Links only, no stored preview image, to keep the record lean over many months. The Word document renders the preview from the link when the document is generated.
- **What it does not do:** it does not store every internal edit or unapproved draft that was never shared with a reviewer.

---

## 6. Permanent copy of the final asset

- **Trigger:** when a post reaches Approved.
- **Action:** save an actual copy of the final media into a dedicated folder in the app's own Google Drive, and record the stored file ID on the post.
- **Why the app's Drive, not Box:** the permanent copy must not depend on a location a person can reorganize. Box is human-managed, so folders move and links break. A folder owned by the app's own account, untouched by hand, is the copy that survives. Box remains the working and delivery home.
- **Re-approval edge case:** if a post is reopened, changed, and approved again, save the new approved asset as an additional permanent copy rather than overwriting the prior one, so the record shows each approved version.

---

## 7. Delete and unpublish handling (no holes in the record)

If a post is deleted or unpublished after it has been part of a review, its snapshots, trail, and permanent final copy are retained, and the post is marked in the record as Deleted or Unpublished on [date]. The record never silently loses a post that a reviewer already acted on.

---

## 8. Data-model changes required

| Change | Purpose |
|---|---|
| New sheet, e.g. `Post_Versions` | One row per snapshot: Post_ID, version label, copy, media links, stage submitted for, created-by, created-date. |
| New Drive folder + stored file IDs | Permanent copies of approved final assets. |
| Retention flag on Posts | Mark Deleted or Unpublished without removing the row, so Section 7 holds. |
| Comment scope, replacing the current two-way Internal vs client-visible split | Three scopes: `Internal` (agency only), `Local` (local reviewer + agency), `Corporate` (corporate reviewer + agency). Agency reply UI targets which conversation it is posting into. This is the mechanism behind the Section 11 rule and the fix to current behavior. |

Everything else Ali asked for (approvals, names, timestamps, and the comment text itself) is already captured in the current sheets. Only the comment scoping needs to change from two tiers to three.

---

## 9. Code work, high level (for scoping only, no code here)

1. Snapshot hook at the submit-to-review status transition.
2. Permanent-copy save hook at Approved, writing to the app's Drive folder.
3. New reviewer-facing, token-scoped export endpoint, filtered to that reviewer and to client-visible content.
4. Extend the document builder to add the trail, the versions, and the final section.
5. Add the download button to the client portal for local and corporate reviewers.

---

## 10. Confirmed decisions (MJ, July 14)

- Drive room: confirmed plenty of room for permanent finals.
- Date range: the reviewer picks the range they want, matching the agency export.
- Coverage: include both published and approved-but-not-yet-live posts.
- Comment visibility: Corporate sees only the Corporate conversation, never the local thread. The local reviewer (Ali), as liaison, sees both conversations. Agency sees all (Section 11).
- Agency reply targeting: explicit Local / Corporate toggle on the agency reply box.
- Sequencing: tune the model with Ali first. No real Corporate reviewers exist yet, so the current permissive behavior can be fixed along the way. Add real Corporate people only after the local experience is confident and validated.

## 11. Comment visibility rule (governing)

**Rule: Corporate sees only the Corporate conversation and never the local thread. The local reviewer, as liaison, sees both conversations.**

- **Local reviewer (Ali):** sees her own Local conversation with the agency AND the Corporate conversation, because she is the primary point of contact with Corporate. This matches today's behavior for the local reviewer and does not change.
- **Corporate reviewer:** sees only the Corporate conversation, meaning Corporate's own comments and agency replies written into the Corporate conversation. Corporate never sees the local back-and-forth. This is the protection, and the one behavior that changes from today.
- **Agency:** sees every conversation, plus its own internal notes.

Because the local reviewer can see Corporate's comments, if Corporate ever needs a truly private aside to the agency, that is the Internal lane (agency only), not the Corporate conversation.

Passing context is deliberate, not automatic. If the agency wants Corporate to have context from the local round, the agency writes a note into the Corporate conversation. There is no per-comment "share upward" toggle, so nothing from the local thread can leak into Corporate's view by accident. This applies identically to the portal view and to every download.

Agency reply targeting: the agency reply box carries an explicit Local / Corporate toggle, so each agency reply is filed into the correct conversation.

**Current-behavior fix required.** As of today the live app shows both local and corporate reviewers the full non-internal thread, so Corporate would see Ali's local comments. The function's own docstring claims "Corporate sees Corporate_Reply only," but the code overrides that. This build corrects the code to enforce the rule above. Safe to fix along the way because no real Corporate reviewers are in the system yet.
