# Manual Google Sheet Changes Required

These are new columns the code now expects. Claude cannot edit the live Google Sheet directly, so add these manually in the spreadsheet before deploying the updated code (SPREADSHEET_ID in Config.gs).

## Authorized_Clients
Add column: **Default_Channel**
- Values: `Email`, `URL`, or `Both`
- Leave blank for Local-access rows (not used, only applies to Corporate approvers)
- For each existing Corporate approver row, set to whichever channel they should default to when MJ or the local client opens the send picker. Blank defaults to `Email` in code.

## Notification_Queue
Add column: **Delivery_Channel**
- Populated automatically by the app at send time (`Email`, `URL`, or `Both`)
- No manual entry needed, just add the empty column so writes don't fail

## Comments
Add column: **Source_Tag**
- Populated automatically when a corporate approver fills in the optional "Responding as" field on a URL-delivered session (e.g., "Legal", "Communications")
- Blank for all other comments
- No manual entry needed, just add the empty column

## Post_Approvals
Add column: **Decided_By_Name**
- Populated automatically when a corporate approver clicks Approve or Request Changes via a URL-delivered link
- Self-reported name of whoever actually made the decision, separate from Approver_Email (which reflects whose link it was)
- Blank for email-delivered decisions (not required on that path)
- No manual entry needed, just add the empty column

## Order
Add these four columns before redeploying Code.gs / DataService.gs, since the new read/write functions expect them to exist. Column position doesn't matter, the code reads by header name.
