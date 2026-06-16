# IES-TEXA Social Media Approval App — Setup Instructions
*Written for non-coders. Follow every step in order.*

---

## What you'll need before you start

- A Google account (your finnpartners.com Google account works)
- About 20 minutes
- The 6 code files in this folder

---

## PART 1: Create the Google Sheets Database

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new blank spreadsheet**.
2. Name it: `IES-TEXA Social Media Planner - Database`
3. You'll need to create **7 sheets** (tabs at the bottom). By default you get one called "Sheet1" — rename it and add more.

To rename a tab: right-click the tab name → Rename.
To add a tab: click the **+** button at the bottom left.

Create these 7 tabs with these exact names (spelling and capitalization matter):

| Tab name |
|---|
| Posts |
| Post_Approvals |
| Comments |
| Notification_Queue |
| Authorized_Clients |
| Clients |
| Users |

4. In each tab, add the following headers in **Row 1**. Click cell A1, type the first header, press Tab to move to B1, type the next, and so on.

### Posts tab — headers in Row 1:
`ID` | `Client_ID` | `Title` | `Post_Copy` | `Platform` | `Media_URL` | `Scheduled_Date` | `Status` | `Created_By` | `Created_Date` | `Modified_Date` | `Modified_By` | `Internal_Notes`

### Post_Approvals tab — headers in Row 1:
`ID` | `Post_ID` | `Stage` | `Approver_Email` | `Approver_Name` | `Approval_Status` | `Decision_Date` | `Decision_Notes` | `Email_Sent_Date` | `Created_Date`

### Comments tab — headers in Row 1:
`ID` | `Post_ID` | `Author_Email` | `Author_Name` | `Comment_Text` | `Comment_Type` | `Created_Date`

### Notification_Queue tab — headers in Row 1:
`ID` | `Post_ID` | `Approver_Email` | `Approver_Name` | `Stage` | `Send_At` | `Sent` | `Created_By` | `Created_Date`

### Authorized_Clients tab — headers in Row 1:
`ID` | `Client_ID` | `Email` | `Access_Token` | `Access_Level` | `Status` | `Created_Date` | `Last_Login`

### Clients tab — headers in Row 1:
`ID` | `Name` | `Code` | `Status`

### Users tab — headers in Row 1:
`ID` | `Email` | `Full_Name` | `Role` | `Status`

5. **Copy the Spreadsheet ID.** Look at the URL in your browser when the spreadsheet is open. It looks like:
   `https://docs.google.com/spreadsheets/d/`**`1ABC123xyz...`**`/edit`
   Copy the long string between `/d/` and `/edit`. That's your Spreadsheet ID. Save it somewhere — you'll need it in a moment.

---

## PART 2: Add Your Data

### In the Clients tab, add one row of data (starting in Row 2):
| ID | Name | Code | Status |
|---|---|---|---|
| CLT-IES001 | IES-TEXA | IESTEXA | Active |

### In the Users tab, add your agency team members (Row 2 and down):
| ID | Email | Full_Name | Role | Status |
|---|---|---|---|---|
| USR-001 | mj.wagner@finnpartners.com | MJ Wagner | Admin | Active |
| USR-002 | (other team member email) | (name) | Admin | Active |

Add one row per person on your team who will use the agency side of the app.

### In the Authorized_Clients tab, add the IES-TEXA approvers (Row 2 and down):

You need to generate a random token for each approver. To generate a token, go to [random.org/strings](https://www.random.org/strings/?num=1&len=32&digits=on&upperalpha=on&loweralpha=on&unique=on&format=html&rng=new) and copy the result.

| ID | Client_ID | Email | Access_Token | Access_Level | Status | Created_Date | Last_Login |
|---|---|---|---|---|---|---|---|
| AC-001 | CLT-IES001 | (local approver email) | (32-char token) | Local | Active | (today's date) | |
| AC-002 | CLT-IES001 | (corporate approver email) | (different 32-char token) | Corporate | Active | (today's date) | |

**Save both tokens somewhere safe** — you'll use them to build the portal URLs later.

---

## PART 3: Create the Google Apps Script Project

1. Go to [script.google.com](https://script.google.com)
2. Click **New project** (top left)
3. Name the project: `IES-TEXA Social Media Approval App`

You'll see one file already there called `Code.gs` with a placeholder function. You're going to replace it and add more files.

### Add the files one by one:

**File 1: Config.gs**
- In the left sidebar, click the **+** next to "Files"
- Choose "Script"
- Name it `Config` (no .gs needed — it adds that automatically)
- Delete everything in the editor
- Open the file `Config.gs` from this folder, copy everything, paste it into the editor
- **IMPORTANT:** Find this line: `SPREADSHEET_ID: 'PASTE_YOUR_SPREADSHEET_ID_HERE'`
- Replace `PASTE_YOUR_SPREADSHEET_ID_HERE` with the ID you copied in Part 1
- Leave `APP_URL` alone for now — you'll fill that in after deploying
- Click the floppy disk icon (or Cmd+S) to save

**File 2: DataService.gs**
- Click **+** → Script → name it `DataService`
- Delete everything, paste in the contents of `DataService.gs`
- Save

**File 3: EmailService.gs**
- Click **+** → Script → name it `EmailService`
- Delete everything, paste in the contents of `EmailService.gs`
- Save

**File 4: Code.gs**
- This one already exists. Click on it in the sidebar.
- Delete everything in it
- Paste in the contents of `Code.gs`
- Save

**File 5: Index.html**
- Click **+** → **HTML** (not Script) → name it `Index`
- Delete everything, paste in the contents of `Index.html`
- Save

**File 6: ClientPortal.html**
- Click **+** → **HTML** → name it `ClientPortal`
- Delete everything, paste in the contents of `ClientPortal.html`
- Save

---

## PART 4: Deploy the App

1. In the GAS editor, click the blue **Deploy** button (top right) → **New deployment**
2. Click the gear icon next to "Type" and choose **Web app**
3. Fill in:
   - Description: `IES-TEXA Approval App v1`
   - **Execute as:** `Me (mj.wagner@finnpartners.com)`
   - **Who has access:** `Anyone`
4. Click **Deploy**
5. Google will ask you to authorize the app. Click **Authorize access** → choose your finnpartners.com account → click **Allow**
6. You'll see a "Deployment ID" and a **Web app URL**. It looks like:
   `https://script.google.com/macros/s/AKfycb.../exec`
   **Copy this URL — this is your app URL.**

---

## PART 5: Finish Setup

1. Go back to `Config.gs` in the GAS editor
2. Find: `APP_URL: 'PASTE_YOUR_DEPLOYED_APP_URL_HERE'`
3. Replace `PASTE_YOUR_DEPLOYED_APP_URL_HERE` with the URL you just copied
4. Save
5. **Redeploy:** Click Deploy → **Manage deployments** → click the pencil (edit) icon on your deployment → change version to "New version" → Save

### Set up the notification scheduler (important!):
1. In the GAS editor, open `Code.gs`
2. In the function dropdown at the top, find `setupNotificationTrigger`
3. Click the **Run** button (▶)
4. This installs a background job that checks for scheduled notifications every 15 minutes

---

## PART 6: Test It

### Agency view:
Open your App URL in a browser. You should see the Anthology FINN Partners header and a calendar. If it asks you to sign in, sign in with your finnpartners.com Google account.

### Client portal:
Build the URL for each approver:
- Local approver: `{YOUR_APP_URL}?page=client&token={their token from the Authorized_Clients sheet}`
- Corporate approver: `{YOUR_APP_URL}?page=client&token={their token}`

Open the corporate approver URL in an incognito window to see exactly what she sees.

### Create your first post:
1. In the agency view, click the **+** button
2. Fill in a test post
3. Change the status to `Local_Client_Review`
4. In the Notification Control panel, check the local approver and click "Send Notification"
5. Check that an email arrives

---

## PART 7: Share with the Team

- **Agency URL** (your team): `{YOUR_APP_URL}` — they need to be logged into their finnpartners.com Google account to access it. Add their emails to the Users sheet.
- **Local approver URL**: `{YOUR_APP_URL}?page=client&token={local token}` — bookmark this for them or send it once
- **Corporate approver URL**: `{YOUR_APP_URL}?page=client&token={corporate token}` — she'll get it in every notification email automatically, so she doesn't need to bookmark it

---

## Troubleshooting

**"You don't have permission to access this app"** — Make sure your email is in the Users sheet and you're signed in with the right Google account.

**"Invalid or expired token"** — Double-check the token in Authorized_Clients matches the URL exactly (case-sensitive).

**Emails not sending** — Check that you authorized the app in Part 4. In GAS, go to Project Settings → scroll down to see if Gmail permission is listed.

**Changes not saving** — Re-deploy after any code changes (Deploy → Manage deployments → edit → New version → Save).

---

*Built with Claude Fable · Anthology FINN Partners · June 2026*
