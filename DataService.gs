/**
 * DataService.gs
 * Anthology FINN Partners — IES-TEXA Social Post Approval Tool
 * All Google Sheets read/write operations.
 */

// ---------------------------------------------------------------------------
// Core sheet helpers
// ---------------------------------------------------------------------------

/**
 * Returns the configured spreadsheet.
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

/**
 * Returns a sheet by name, throwing a clear error if missing.
 * @param {string} name
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheet_(name) {
  var sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw new Error('Sheet not found: ' + name + '. Check the spreadsheet structure.');
  }
  return sheet;
}

/**
 * Reads a sheet into an array of objects keyed by header row.
 * Each object also receives a _rowIndex property (1-based sheet row).
 * @param {string} sheetName
 * @return {{headers: Array<string>, rows: Array<Object>}}
 */
function readSheet_(sheetName) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length === 0) return { headers: [], rows: [] };
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    // Skip completely empty rows.
    var isEmpty = row.every(function (cell) { return cell === '' || cell === null; });
    if (isEmpty) continue;
    var obj = { _rowIndex: i + 1 };
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

/**
 * Appends a row to a sheet, mapping an object to the header order.
 * @param {string} sheetName
 * @param {Object} data - keys matching the sheet headers
 */
function appendRow_(sheetName, data) {
  var sheet = getSheet_(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  var row = headers.map(function (h) {
    return data.hasOwnProperty(h) ? data[h] : '';
  });
  sheet.appendRow(row);
}

/**
 * Updates specific columns of a row identified by its ID column value.
 * @param {string} sheetName
 * @param {string} id - value in the ID column
 * @param {Object} updates - keys matching the sheet headers
 * @return {boolean} true if a row was updated
 */
function updateRowById_(sheetName, id, updates) {
  var sheet = getSheet_(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return false;
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var idCol = headers.indexOf('ID');
  if (idCol === -1) throw new Error('Sheet ' + sheetName + ' has no ID column.');
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(id)) {
      for (var key in updates) {
        if (!updates.hasOwnProperty(key)) continue;
        var col = headers.indexOf(key);
        if (col === -1) continue;
        sheet.getRange(i + 1, col + 1).setValue(updates[key]);
      }
      return true;
    }
  }
  return false;
}

/**
 * Generates the next sequential ID for a sheet, e.g. POST-001 -> POST-002.
 * @param {string} sheetName
 * @return {string}
 */
function generateId_(sheetName) {
  var prefix = CONFIG.ID_PREFIXES[sheetName];
  if (!prefix) throw new Error('No ID prefix configured for sheet: ' + sheetName);
  var data = readSheet_(sheetName);
  var max = 0;
  data.rows.forEach(function (row) {
    var id = String(row.ID || '');
    var match = id.match(new RegExp('^' + prefix + '-(\\d+)$'));
    if (match) {
      var n = parseInt(match[1], 10);
      if (n > max) max = n;
    }
  });
  var next = max + 1;
  var padded = next < 1000 ? ('000' + next).slice(-3) : String(next);
  return prefix + '-' + padded;
}

/**
 * Converts a row object's values into client-safe strings
 * (google.script.run cannot serialize Date objects inside objects).
 * @param {Object} row
 * @return {Object}
 */
function serializeRow_(row) {
  var out = {};
  for (var key in row) {
    if (!row.hasOwnProperty(key)) continue;
    if (key === '_rowIndex') continue;
    var v = row[key];
    if (v instanceof Date) {
      out[key] = formatDateValue(v);
    } else if (v === null || v === undefined) {
      out[key] = '';
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

/**
 * Runs a function while holding the script lock (for safe writes).
 * @param {Function} fn
 * @return {*} fn's return value
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/**
 * Returns all posts for the configured client, serialized for the front end.
 * @return {Array<Object>}
 */
function dsGetAllPosts() {
  var data = readSheet_(CONFIG.SHEETS.POSTS);
  return data.rows
    .filter(function (r) {
      return !r.Client_ID || String(r.Client_ID) === CONFIG.CLIENT_ID;
    })
    .map(serializeRow_);
}

/**
 * Returns a single post by ID, or null.
 * @param {string} postId
 * @return {Object|null}
 */
function dsGetPostById(postId) {
  var data = readSheet_(CONFIG.SHEETS.POSTS);
  for (var i = 0; i < data.rows.length; i++) {
    if (String(data.rows[i].ID) === String(postId)) {
      return serializeRow_(data.rows[i]);
    }
  }
  return null;
}

/**
 * Creates a new post and returns it.
 * @param {Object} postData - Title, Post_Copy, Platform, Media_URL, Scheduled_Date, Internal_Notes
 * @param {string} userEmail
 * @return {Object} the created post
 */
function dsCreatePost(postData, userEmail) {
  return withLock_(function () {
    var now = new Date();
    var id = generateId_(CONFIG.SHEETS.POSTS);
    var row = {
      ID: id,
      Client_ID: CONFIG.CLIENT_ID,
      Title: postData.Title || 'Untitled post',
      Post_Copy: postData.Post_Copy || '',
      Platform: postData.Platform || '',
      Media_URL: postData.Media_URL || '',
      LinkedIn_URL: postData.LinkedIn_URL || '',
      Facebook_URL: postData.Facebook_URL || '',
      Instagram_URL: postData.Instagram_URL || '',
      Carousel_URLs: postData.Carousel_URLs || '',
      Scheduled_Date: postData.Scheduled_Date || '',
      Status: CONFIG.STATUSES.DRAFT,
      Created_By: userEmail,
      Created_Date: now,
      Modified_Date: now,
      Modified_By: userEmail,
      Internal_Notes: postData.Internal_Notes || ''
    };
    appendRow_(CONFIG.SHEETS.POSTS, row);
    return dsGetPostById(id);
  });
}

/**
 * Updates an existing post's editable fields.
 * @param {string} postId
 * @param {Object} postData
 * @param {string} userEmail
 * @return {Object} the updated post
 */
function dsUpdatePost(postId, postData, userEmail) {
  return withLock_(function () {
    var updates = {
      Modified_Date: new Date(),
      Modified_By: userEmail
    };
    ['Title', 'Post_Copy', 'Platform', 'Media_URL',
     'LinkedIn_URL', 'Facebook_URL', 'Instagram_URL', 'Carousel_URLs',
     'Scheduled_Date', 'Internal_Notes']
      .forEach(function (field) {
        if (postData.hasOwnProperty(field)) updates[field] = postData[field];
      });
    var ok = updateRowById_(CONFIG.SHEETS.POSTS, postId, updates);
    if (!ok) throw new Error('Post not found: ' + postId);
    return dsGetPostById(postId);
  });
}

/**
 * Updates a post's status.
 * @param {string} postId
 * @param {string} status
 * @param {string} userEmail
 * @return {Object} the updated post
 */
function dsUpdatePostStatus(postId, status, userEmail) {
  return withLock_(function () {
    var validStatuses = Object.keys(CONFIG.STATUS_COLORS);
    if (validStatuses.indexOf(status) === -1) {
      throw new Error('Invalid status: ' + status);
    }
    var ok = updateRowById_(CONFIG.SHEETS.POSTS, postId, {
      Status: status,
      Modified_Date: new Date(),
      Modified_By: userEmail
    });
    if (!ok) throw new Error('Post not found: ' + postId);
    return dsGetPostById(postId);
  });
}

// ---------------------------------------------------------------------------
// Post_Approvals
// ---------------------------------------------------------------------------

/**
 * Returns all approval records for a post, newest first.
 * @param {string} postId
 * @return {Array<Object>}
 */
function dsGetApprovalsForPost(postId) {
  var data = readSheet_(CONFIG.SHEETS.APPROVALS);
  return data.rows
    .filter(function (r) { return String(r.Post_ID) === String(postId); })
    .map(serializeRow_)
    .reverse();
}

/**
 * Creates a Pending approval record for an approver at a stage,
 * unless an identical Pending record already exists.
 * @param {string} postId
 * @param {string} stage
 * @param {string} approverEmail
 * @param {string} approverName
 * @return {Object} the approval record (existing or new)
 */
function dsCreatePendingApproval(postId, stage, approverEmail, approverName) {
  return withLock_(function () {
    var data = readSheet_(CONFIG.SHEETS.APPROVALS);
    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      if (String(r.Post_ID) === String(postId) &&
          String(r.Stage) === stage &&
          String(r.Approver_Email).toLowerCase() === String(approverEmail).toLowerCase() &&
          String(r.Approval_Status) === CONFIG.APPROVAL_STATUSES.PENDING) {
        return serializeRow_(r);
      }
    }
    var id = generateId_(CONFIG.SHEETS.APPROVALS);
    var row = {
      ID: id,
      Post_ID: postId,
      Stage: stage,
      Approver_Email: approverEmail,
      Approver_Name: approverName,
      Approval_Status: CONFIG.APPROVAL_STATUSES.PENDING,
      Decision_Date: '',
      Decision_Notes: '',
      Email_Sent_Date: '',
      Created_Date: new Date()
    };
    appendRow_(CONFIG.SHEETS.APPROVALS, row);
    return serializeRow_(row);
  });
}

/**
 * Records an approver's decision. Updates the latest Pending record for
 * this approver/post/stage, or creates a new record if none is pending.
 * @param {string} postId
 * @param {string} stage
 * @param {string} approverEmail
 * @param {string} approverName
 * @param {string} decision - Approved or Changes_Requested
 * @param {string} notes
 * @return {Object} the decision record
 */
function dsRecordDecision(postId, stage, approverEmail, approverName, decision, notes) {
  return withLock_(function () {
    var now = new Date();
    var data = readSheet_(CONFIG.SHEETS.APPROVALS);
    var pendingRow = null;
    for (var i = data.rows.length - 1; i >= 0; i--) {
      var r = data.rows[i];
      if (String(r.Post_ID) === String(postId) &&
          String(r.Stage) === stage &&
          String(r.Approver_Email).toLowerCase() === String(approverEmail).toLowerCase() &&
          String(r.Approval_Status) === CONFIG.APPROVAL_STATUSES.PENDING) {
        pendingRow = r;
        break;
      }
    }
    if (pendingRow) {
      updateRowById_(CONFIG.SHEETS.APPROVALS, pendingRow.ID, {
        Approval_Status: decision,
        Decision_Date: now,
        Decision_Notes: notes || ''
      });
      pendingRow.Approval_Status = decision;
      pendingRow.Decision_Date = now;
      pendingRow.Decision_Notes = notes || '';
      return serializeRow_(pendingRow);
    }
    var id = generateId_(CONFIG.SHEETS.APPROVALS);
    var row = {
      ID: id,
      Post_ID: postId,
      Stage: stage,
      Approver_Email: approverEmail,
      Approver_Name: approverName,
      Approval_Status: decision,
      Decision_Date: now,
      Decision_Notes: notes || '',
      Email_Sent_Date: '',
      Created_Date: now
    };
    appendRow_(CONFIG.SHEETS.APPROVALS, row);
    return serializeRow_(row);
  });
}

/**
 * Marks the approval record's notification email as sent.
 * @param {string} postId
 * @param {string} stage
 * @param {string} approverEmail
 */
function dsMarkApprovalEmailSent(postId, stage, approverEmail) {
  var data = readSheet_(CONFIG.SHEETS.APPROVALS);
  for (var i = data.rows.length - 1; i >= 0; i--) {
    var r = data.rows[i];
    if (String(r.Post_ID) === String(postId) &&
        String(r.Stage) === stage &&
        String(r.Approver_Email).toLowerCase() === String(approverEmail).toLowerCase() &&
        String(r.Approval_Status) === CONFIG.APPROVAL_STATUSES.PENDING) {
      updateRowById_(CONFIG.SHEETS.APPROVALS, r.ID, { Email_Sent_Date: new Date() });
      return;
    }
  }
}

/**
 * True if every approval record for the post at this stage is Approved
 * (and there is at least one record).
 * @param {string} postId
 * @param {string} stage
 * @return {boolean}
 */
function dsAllApprovedAtStage(postId, stage) {
  var data = readSheet_(CONFIG.SHEETS.APPROVALS);
  var records = data.rows.filter(function (r) {
    return String(r.Post_ID) === String(postId) && String(r.Stage) === stage;
  });
  if (records.length === 0) return false;
  // Consider only the latest record per approver.
  var latestByApprover = {};
  records.forEach(function (r) {
    latestByApprover[String(r.Approver_Email).toLowerCase()] = r;
  });
  for (var email in latestByApprover) {
    if (String(latestByApprover[email].Approval_Status) !== CONFIG.APPROVAL_STATUSES.APPROVED) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/**
 * Returns all comments for a post, oldest first.
 * @param {string} postId
 * @return {Array<Object>}
 */
function dsGetCommentsForPost(postId) {
  var data = readSheet_(CONFIG.SHEETS.COMMENTS);
  return data.rows
    .filter(function (r) { return String(r.Post_ID) === String(postId); })
    .map(serializeRow_);
}

/**
 * Adds a comment to a post.
 * @param {string} postId
 * @param {string} authorEmail
 * @param {string} authorName
 * @param {string} text
 * @param {string} type - Internal or Client_Reply
 * @return {Object} the created comment
 */
function dsAddComment(postId, authorEmail, authorName, text, type) {
  return withLock_(function () {
    var id = generateId_(CONFIG.SHEETS.COMMENTS);
    var row = {
      ID: id,
      Post_ID: postId,
      Author_Email: authorEmail,
      Author_Name: authorName,
      Comment_Text: text,
      Comment_Type: type,
      Created_Date: new Date()
    };
    appendRow_(CONFIG.SHEETS.COMMENTS, row);
    return serializeRow_(row);
  });
}

// ---------------------------------------------------------------------------
// Authorized_Clients
// ---------------------------------------------------------------------------

/**
 * Returns active authorized clients, optionally filtered by access level.
 * @param {string} [accessLevel] - 'Local' or 'Corporate'
 * @return {Array<Object>}
 */
function dsGetAuthorizedClients(accessLevel) {
  var data = readSheet_(CONFIG.SHEETS.AUTHORIZED_CLIENTS);
  return data.rows
    .filter(function (r) {
      if (String(r.Status).toLowerCase() !== 'active') return false;
      if (String(r.Client_ID) !== CONFIG.CLIENT_ID) return false;
      if (accessLevel && String(r.Access_Level) !== accessLevel) return false;
      return true;
    })
    .map(serializeRow_);
}

/**
 * Looks up an authorized client by access token.
 * @param {string} token
 * @return {Object|null}
 */
function dsGetClientByToken(token) {
  if (!token) return null;
  var data = readSheet_(CONFIG.SHEETS.AUTHORIZED_CLIENTS);
  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];
    if (String(r.Access_Token) === String(token) &&
        String(r.Status).toLowerCase() === 'active') {
      return serializeRow_(r);
    }
  }
  return null;
}

/**
 * Updates the Last_Login timestamp for a token.
 * @param {string} token
 */
function dsTouchLastLogin(token) {
  try {
    var client = dsGetClientByToken(token);
    if (client) {
      updateRowById_(CONFIG.SHEETS.AUTHORIZED_CLIENTS, client.ID, { Last_Login: new Date() });
    }
  } catch (err) {
    console.error('dsTouchLastLogin failed: ' + err.message);
  }
}

/**
 * Returns a name for an authorized client row. The Authorized_Clients sheet
 * has no name column, so derive a friendly name from the email local part.
 * @param {Object} clientRow
 * @return {string}
 */
function dsClientDisplayName(clientRow) {
  var email = String(clientRow.Email || '');
  var local = email.split('@')[0] || email;
  return local.split(/[._-]/).map(function (part) {
    return part ? part.charAt(0).toUpperCase() + part.slice(1) : part;
  }).join(' ');
}

// ---------------------------------------------------------------------------
// Notification_Queue
// ---------------------------------------------------------------------------

/**
 * Adds a notification to the queue.
 * @param {string} postId
 * @param {string} approverEmail
 * @param {string} approverName
 * @param {string} stage
 * @param {string|Date} sendAt - 'now' or a datetime
 * @param {string} createdBy
 * @return {Object} the queued row
 */
function dsQueueNotification(postId, approverEmail, approverName, stage, sendAt, createdBy) {
  return withLock_(function () {
    var id = generateId_(CONFIG.SHEETS.NOTIFICATION_QUEUE);
    var row = {
      ID: id,
      Post_ID: postId,
      Approver_Email: approverEmail,
      Approver_Name: approverName,
      Stage: stage,
      Send_At: sendAt,
      Sent: false,
      Created_By: createdBy,
      Created_Date: new Date()
    };
    appendRow_(CONFIG.SHEETS.NOTIFICATION_QUEUE, row);
    return serializeRow_(row);
  });
}

/**
 * Returns all unsent notification rows (raw, with _rowIndex preserved via ID).
 * @return {Array<Object>}
 */
function dsGetUnsentNotifications() {
  var data = readSheet_(CONFIG.SHEETS.NOTIFICATION_QUEUE);
  return data.rows.filter(function (r) {
    var sent = String(r.Sent).toUpperCase();
    return sent !== 'TRUE';
  });
}

/**
 * Marks all unsent batch notifications for a given post + stage as sent (dismissed).
 * Call this before queuing new notifications to avoid duplicates when status goes backwards.
 * @param {string} postId
 * @param {string} stage
 */
function dsClearUnsentBatchNotifications(postId, stage) {
  return withLock_(function () {
    var data = readSheet_(CONFIG.SHEETS.NOTIFICATION_QUEUE);
    data.rows.forEach(function (r) {
      if (String(r.Post_ID) === String(postId) &&
          String(r.Stage) === String(stage) &&
          String(r.Send_At).toLowerCase() === 'batch' &&
          String(r.Sent).toUpperCase() !== 'TRUE') {
        updateRowById_(CONFIG.SHEETS.NOTIFICATION_QUEUE, r.ID, { Sent: true, Send_At: new Date() });
      }
    });
  });
}

/**
 * Marks a notification row as sent.
 * @param {string} notificationId
 */
function dsMarkNotificationSent(notificationId) {
  updateRowById_(CONFIG.SHEETS.NOTIFICATION_QUEUE, notificationId, {
    Sent: true,
    Send_At: new Date()
  });
}

// ---------------------------------------------------------------------------
// Users (agency)
// ---------------------------------------------------------------------------

/**
 * Returns the active agency user record for an email, or null.
 * @param {string} email
 * @return {Object|null}
 */
function dsGetUserByEmail(email) {
  if (!email) return null;
  var data = readSheet_(CONFIG.SHEETS.USERS);
  for (var i = 0; i < data.rows.length; i++) {
    var r = data.rows[i];
    if (String(r.Email).toLowerCase() === String(email).toLowerCase() &&
        String(r.Status).toLowerCase() === 'active') {
      return serializeRow_(r);
    }
  }
  return null;
}

/**
 * Returns all emails that should receive agency notifications:
 * the configured list plus active Admin users, de-duplicated.
 * @return {Array<string>}
 */
function dsGetAgencyNotificationEmails() {
  var emails = {};
  CONFIG.AGENCY_NOTIFICATION_EMAILS.forEach(function (e) {
    emails[String(e).toLowerCase()] = String(e);
  });
  try {
    var data = readSheet_(CONFIG.SHEETS.USERS);
    data.rows.forEach(function (r) {
      if (String(r.Role) === CONFIG.ROLES.ADMIN &&
          String(r.Status).toLowerCase() === 'active' && r.Email) {
        emails[String(r.Email).toLowerCase()] = String(r.Email);
      }
    });
  } catch (err) {
    console.error('dsGetAgencyNotificationEmails: could not read Users sheet: ' + err.message);
  }
  var out = [];
  for (var key in emails) out.push(emails[key]);
  return out;
}
