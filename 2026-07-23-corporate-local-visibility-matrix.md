# Corporate vs. Local Visibility Matrix - IES-TEXA Social Media Approval App

Read this before changing anything that touches a client-facing endpoint (`api_client*` functions, ClientPortal.html, the reviewer Word export, or any notification email). Two real Corporate-visibility leaks have shipped in this project by accident (2026-06-23, 2026-07-23), both caught during testing aimed at something else, not by design review. This doc exists so the next change gets checked against a table instead of getting lucky.

## The core rule

Corporate's access is deliberately narrower than Local's. Local (Ali) is the liaison to Corporate and needs the fuller picture. Corporate never needs, and should never see, anything from the Local-only conversation or decision history. When in doubt, Corporate gets less, not more.

## Data type by data type

**Post visibility (which posts show up at all).** Local sees a post once it reaches `Local_Client_Review`, and everything downstream of that (`Revising`, `Awaiting_Corporate`, `Corporate_Review`, `Approved`, `Published`). Corporate only sees `Corporate_Review`, `Approved`, `Published`. A post in `Revising` is visible to Corporate only if Corporate already submitted a decision at their own stage on it, otherwise a Local-only revision cycle stays invisible to Corporate. Enforced in `isPostVisibleToClient_` and `api_clientGetAllPosts` (Code.gs).

**Comments (the conversation).** Corporate sees only `Corporate_Reply` comments. Local sees both `Client_Reply` and `Corporate_Reply`. `Internal` comments are never shown to either. Enforced in `filterCommentsForRole_` (Code.gs), shared by the live portal (`api_clientGetPost`) and the Word export.

**Approval / review trail (decision events like "approved," "requested changes," timestamps).** Corporate sees only `Corporate`-stage decision events. Local sees both `Local_Client`- and `Corporate`-stage events. This includes the bare event line even when it has no note attached, a Local-stage "requested changes" with zero comment text is still a Local-stage event and still hidden from Corporate. Enforced in `filterApprovalsForRole_` (Code.gs, added 2026-07-23), used only by the Word export today, the live portal doesn't surface the trail at all (see below).

**Live portal single-post view (`api_clientGetPost`).** Returns `post`, role-scoped `comments`, and `canUndo`. Does not return approvals or the trail at all, for either role. If the trail is ever added to the live portal (not just the Word export), it must be run through `filterApprovalsForRole_` the same way, this function was written generically enough to reuse.

**Internal-only fields (`Internal_Notes`, `Created_By`, `Modified_By`).** Stripped for every client regardless of role, via `stripInternalFields_`. No Local-vs-Corporate distinction needed here, these are agency-only for both.

**Version snapshots and final assets (`Post_Versions`, `Post_Final_Assets`).** Not role-filtered, both Local and Corporate see the same version history and final-asset copies. This is intentional, these represent the post's actual content over time, not a conversation, there's nothing Local-only to hide here.

**Is_Test posts.** Invisible to both Local and Corporate regardless of status, checked before any status-based visibility logic runs.

**Digest / notification emails (`sendClientDigestEmail`).** Only ever includes Title, Scheduled_Date, Platform, and a short Post_Copy excerpt. Never includes comments or approval history for either role, so this path has no asymmetric-visibility risk to begin with.

**Recipient pickers (Send to Local Client / Send to Corporate, agency-side only).** Not client-facing, this is what the agency (and Local, for the Corporate send) uses to choose who gets notified. Scoped by `Access_Level`, not part of what a client token can see.

## When adding a new client-facing feature

Ask two questions before shipping: (1) does this expose anything from Post_Approvals or Comments, and if so, does it go through `filterApprovalsForRole_` / `filterCommentsForRole_` rather than a fresh, unfiltered read, and (2) if this is genuinely new data (not one of the types above), what should Corporate NOT see about it, decide that explicitly rather than defaulting to "show everything."
