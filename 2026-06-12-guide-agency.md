# IES-TEXA Social Media Approval App — Agency Guide

**Anthology FINN Partners — Internal Use**
Last updated: June 15, 2026

---

## What This App Does

The approval app gives IES-TEXA clients a branded portal to review, approve, or request changes on social media posts before they go live. The agency controls the workflow entirely — clients can only see what you send them.

There are two client tiers:

- **Local Client** — reviews posts first
- **Corporate** — final sign-off after local approves

---

## Initial Setup (One-Time)

### 1. Spreadsheet

The database lives in Google Sheets. Open it via the link in the `SPREADSHEET_ID` comment at the top of `Config.gs`.

Required sheets and columns:

| Sheet | Key Columns |
|-------|-------------|
| Posts | ID, Title, Post_Copy, Status, Platform, Scheduled_Date, Facebook_URL, Instagram_URL, LinkedIn_URL, Carousel_URLs, Internal_Notes, Created_By, Created_Date |
| Post_Approvals | ID, Post_ID, Stage, Approver_Email, Approver_Name, Approval_Status, Decision_Date, Decision_Notes |
| Comments | ID, Post_ID, Author_Email, Author_Name, Comment_Text, Comment_Type, Created_Date |
| Notification_Queue | ID, Post_ID, Approver_Email, Approver_Name, Stage, Send_At, Sent, Created_By, Created_Date |
| Authorized_Clients | ID, Client_ID, Email, Access_Level, Access_Token, Status, Last_Login |
| Clients | ID, Client_Name |
| Users | ID, Email, Full_Name, Role, Status |

### 2. Config.gs

Fill in these values:

```
SPREADSHEET_ID             — the Google Sheets ID from the URL
APP_URL                    — the deployed web app URL (fill in AFTER first deployment)
CLIENT_ID                  — 'CLT-IES001' (already set)
AGENCY_NOTIFICATION_EMAILS — your team's emails for client action notifications
SLACK_WEBHOOK_URL          — Slack incoming webhook URL for #texa_social (see Slack Notifications below)
```

### 3. Authorized Clients

In the **Authorized_Clients** sheet, add one row per reviewer:

| Field | Value |
|-------|-------|
| ID | AC-001, AC-002, etc. |
| Client_ID | CLT-IES001 |
| Email | reviewer's email address |
| Access_Level | `Local` for local client; `Corporate` for corporate |
| Access_Token | any unique string (e.g., `aloha2026local`) — this becomes part of their portal link |
| Status | `active` |

### 4. Users Sheet

Add each agency team member who needs access to the agency dashboard:

| Field | Value |
|-------|-------|
| ID | USR-001, etc. |
| Email | their @finnpartners.com Google Workspace email |
| Full_Name | their name |
| Role | `Admin` |
| Status | `active` |

### 5. Deploy the Web App

1. Open the GAS editor: **Extensions → Apps Script**
2. Click **Deploy → Manage Deployments**
3. Click the pencil (edit) icon on the existing deployment
4. Set **Version** to "New version"
5. Click **Deploy**
6. Copy the `/exec` URL and paste it into `CONFIG.APP_URL` in Config.gs
7. Deploy again with the updated URL

> **Important:** Always use **Manage Deployments → edit existing** to update. Never use "New deployment" — that creates a new URL and breaks existing client links.

### 6. Set Up the 15-Minute Trigger

Run this once in the GAS editor to install the notification queue trigger:

1. In the GAS editor, click **Run → Run function → setupNotificationTrigger**
2. Authorize when prompted
3. Confirm in **Triggers** (left menu) that `processNotificationQueue` runs every 15 minutes

---

## Day-to-Day Workflow

### Creating a Post

1. Open the agency dashboard
2. Click the **+** button (bottom right)
3. Fill in: Title, Post Copy, Platform(s), Scheduled Date
4. Add media URLs — see Box tips below
5. Status starts as **Draft**
6. Click **Save post** — the panel closes automatically so you can see the calendar

### Box Media URL Tips

The calendar shows an image thumbnail on each post card. For the image to preview, the URL must be a direct-download link, not a standard Box shared link.

**Box URL fix:** Standard Box shared links use `/s/` in the URL. Replace `/s/` with `/shared/static/` to get the direct-download version.

Example:
```
Standard:      https://app.box.com/s/abc123xyz
Direct-download: https://app.box.com/shared/static/abc123xyz
```

The direct-download URL is also available via **Box → Share → Direct Link**.

For carousel images, use one URL per line in the Carousel/Additional field. The first URL in any media field is used as the calendar thumbnail.

### Sending to Local Client Review

1. Edit the post, change Status to **Local Client Review**
2. Click **Save post** — panel closes, a notification is queued, and a toolbar badge appears
3. When ready to notify the client, click **Send to Local Client** in the toolbar
4. Local clients receive one digest email listing all queued posts

> The badge pulses orange with a "⚠️ X ready — send to Local!" label. **Don't skip this step** — the client receives no email until you click the button.

### After Local Approves

When local approves all posts at their stage, each post's status changes to **Send to Corporate** (indigo badge). This means local has signed off and the post is ready for corporate — but corporate has not been notified yet.

You can send to corporate from the agency toolbar, **or** the local client can initiate the send directly from their own portal.

**From the agency portal:**
1. An indigo **"⚠️ X ready — send to Corporate!"** badge appears in the toolbar
2. Click **Send to Corporate** when ready
3. Corporate receives one digest email listing all posts

> Again, do not skip this step. The indigo badge means the post is waiting — corporate has not been notified.

### After Corporate Reviews

Corporate reviews posts on their own schedule and batches their decisions. They click **Send Responses** in their portal when done. At that point:

- Local receives a single digest email summarizing all decisions (approved / changes requested / notes)
- Agency receives the same digest to the Slack channel and email

If corporate requested changes on a post, it returns to **Revising** (teal badge) — it's in your court. Make revisions, then use the **Re-send to Corporate** toolbar button to send it back directly to corporate (bypasses local re-review).

### Marking Posts Published

On the agency calendar, **Approved** cards show a **Mark Published →** button. Click it to mark the post as published and update the calendar.

---

## Status Color Reference

| Color | Status | What It Means |
|-------|--------|---------------|
| Gray | Draft | Not yet shared with any client |
| Orange | Local Client Review | Awaiting local client decision |
| Teal | Revising | Agency revising after a change request |
| Indigo | Send to Corporate | Local approved; waiting to notify corporate |
| Purple | Corporate Review | Awaiting corporate decision |
| Green | Approved | All approvals received |
| Dark Green | Published | Posted live |

---

## Toolbar Badge Reference

| Badge | What It Means | Action |
|-------|--------------|--------|
| Orange "⚠️ X ready — send to Local!" | Posts waiting for local client email | Click **Send to Local Client** |
| Indigo "⚠️ X ready — send to Corporate!" | Posts local approved; corporate not notified | Click **Send to Corporate** |
| Indigo "🔄 X revising (corp)" | Posts in Revising caused by corporate change request | Click **Re-send to Corporate** |

---

## Client Portal Links

Each client's portal URL is:

```
[APP_URL]?page=client&token=[Access_Token]
```

Example: `https://script.google.com/.../exec?page=client&token=aloha2026local`

Send this link to the client once — they can bookmark it. It never expires unless you set their `Status` to `inactive` in Authorized_Clients.

---

## Slack Notifications

Agency notifications go to the **#texa_social** Slack channel in addition to email. To set this up:

1. Go to `https://api.slack.com/apps` → **Create New App** → **From scratch**
2. Name the app `IES-TEXA Approvals`, select the Finn Partners workspace
3. In the left nav: **Incoming Webhooks** → toggle **Activate Incoming Webhooks** ON
4. Click **Add New Webhook to Workspace** → select `#texa_social` → Allow
5. Copy the webhook URL and paste it into `SLACK_WEBHOOK_URL` in Config.gs
6. Deploy a new version

Once set, the channel receives a message whenever:
- Local or corporate approves or requests changes on a post
- Local sends posts to corporate
- Corporate sends their batch responses

---

## Resetting Test Data

To start a clean test:
1. In the Posts sheet, set Status back to `Draft` for all test posts
2. In Notification_Queue, delete all rows with `Sent = FALSE`
3. In Post_Approvals, optionally delete test approval rows

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Panel stays open after saving | Old version of app | Redeploy — panel now auto-closes on save |
| Toolbar badge not appearing after client acts | Page needs refresh or batch loader hasn't run | Badge auto-refreshes every 30 seconds; or reload the page |
| Batch badge shows wrong count | Stale unsent notifications from a previous test | Delete Notification_Queue rows with `Send_At='batch'` and `Sent=FALSE` |
| Post disappears from client portal | Status changed to one not visible at that client's level | Check post status; may need to re-send |
| No action buttons in client portal | Client viewing a post not at their action stage | Normal — local acts on Local_Client_Review; corporate on Corporate_Review |
| Agency emails not arriving in Outlook | Finn Partners M365/Proofpoint blocking Google Apps Script sender | Use Slack (see above) — email delivery to @finnpartners.com is blocked at the gateway |
| Image thumbnail not showing | Box URL uses `/s/` (shared link) format | Replace `/s/` with `/shared/static/` in the URL |
| "This review link is no longer valid" | Token in URL doesn't match Authorized_Clients | Verify Access_Token in the sheet; resend the correct link |
