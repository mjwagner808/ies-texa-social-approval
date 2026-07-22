/**
 * Code.gs
 * Anthology FINN Partners — IES-TEXA Social Post Approval Tool
 * Web app entry points, routing, server APIs and queue processing.
 *
 * DEPLOYMENT:
 * 1. Create the spreadsheet with the sheets/columns described in the README
 *    section of the project brief, and paste its ID into CONFIG.SPREADSHEET_ID.
 * 2. Deploy > New deployment > Web app:
 *      - Execute as: Me (the script owner)
 *      - Who has access: Anyone with the link
 * 3. Paste the deployed /exec URL into CONFIG.APP_URL and redeploy.
 * 4. Run setupNotificationTrigger() once from the editor to install the
 *    15-minute notification queue trigger (authorize when prompted).
 */

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Main GET entry point.
 * @param {Object} e - event with e.parameter
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    if (params.page === 'client') {
      return routeClient_(params);
    }
    return routeAgency_(params);
  } catch (err) {
    console.error('doGet error: ' + err.message + '\n' + err.stack);
    return renderMessagePage_('Something went wrong',
      'We hit an unexpected error. Please try again, or contact Anthology FINN Partners.',
      false);
  }
}

/**
 * Main POST entry point (handles the "Request Changes" form from email links).
 * @param {Object} e
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doPost(e) {
  try {
    var params = (e && e.parameter) || {};
    if (params.formAction === 'submitChanges') {
      return handleChangesFormSubmit_(params);
    }
    return renderMessagePage_('Unknown request', 'This request could not be processed.', false);
  } catch (err) {
    console.error('doPost error: ' + err.message + '\n' + err.stack);
    return renderMessagePage_('Something went wrong',
      'We hit an unexpected error while saving your feedback. Please try again.',
      false);
  }
}

/**
 * Includes an HTML partial (standard GAS pattern).
 * @param {string} filename
 * @return {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// ---------------------------------------------------------------------------
// Agency routing
// ---------------------------------------------------------------------------

/**
 * Renders the agency view, enforcing the Users-sheet email check.
 * @param {Object} params
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function routeAgency_(params) {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch (err) {
    email = '';
  }
  if (!email) {
    return renderMessagePage_('Please sign in',
      'Please sign in with your Google account, then reload this page. ' +
      'The agency dashboard requires a signed-in Google account.', false);
  }
  var user = dsGetUserByEmail(email);
  if (!user) {
    return renderMessagePage_('Access not authorized',
    'The account ' + escapeHtml_(email) + ' is not authorized for the agency dashboard. ' +
    'Contact MJ Wagner to be added.', false);
  }
  var template = HtmlService.createTemplateFromFile('Index');
  template.userEmail = email;
  template.userName = user.Full_Name || email;
  template.userRole = user.Role || 'Viewer';
  template.appUrl = CONFIG.APP_URL;
  template.openPostId = params.post || '';
  return template.evaluate()
    .setTitle('IES-TEXA Post Approvals — Anthology FINN Partners')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ---------------------------------------------------------------------------
// Client routing (portal + email action links)
// ---------------------------------------------------------------------------

/**
 * Routes ?page=client requests: portal view or direct email actions.
 * @param {Object} params
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function routeClient_(params) {
  var token = params.token || '';
  var client = dsGetClientByToken(token);
  if (!client) {
    return renderMessagePage_('Link not valid',
      'This review link is no longer valid. Please contact Anthology FINN Partners ' +
      'for a new link.', false);
  }
  dsTouchLastLogin(token);

  if (params.action === 'approve' && params.post) {
    return handleEmailApprove_(client, params.post);
  }
  if (params.action === 'changes' && params.post) {
    return renderChangesForm_(client, params.post, token);
  }

  // True when this link was hand-delivered (e.g. pasted into a corporate
  // communications platform) rather than emailed. Drives the optional source-tag
  // field on comments and the required decided-by-name field on decisions —
  // see CONFIG.URL_DELIVERY_PARAM / sendCorporateBatch_.
  var viaUrlDelivery = params[CONFIG.URL_DELIVERY_PARAM] === CONFIG.URL_DELIVERY_VALUE;

  var template = HtmlService.createTemplateFromFile('ClientPortal');
  template.token = token;
  template.accessLevel = client.Access_Level;
  template.approverName = dsClientDisplayName(client);
  template.approverEmail = client.Email;
  template.viaUrlDelivery = viaUrlDelivery;
  return template.evaluate()
    .setTitle('IES-TEXA — Post Review Portal')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Handles a one-click Approve from an email link.
 * @param {Object} client - authorized client row
 * @param {string} postId
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function handleEmailApprove_(client, postId) {
  var post = dsGetPostById(postId);
  if (!post) {
    return renderMessagePage_('Post not found',
      'We could not find that post. It may have been removed. ' +
      'Please contact Anthology FINN Partners.', false);
  }
  var result = processClientDecision_(client, postId,
    CONFIG.APPROVAL_STATUSES.APPROVED, '');
  if (!result.ok) {
    return renderMessagePage_('Already handled', result.message, true);
  }
  return renderMessagePage_(
    '✅ You\'ve approved "' + escapeHtml_(post.Title) + '". Mahalo!',
    'No further action is needed. The Anthology FINN Partners team has been notified.',
    true);
}

/**
 * Renders the "describe the changes needed" form for an email action link.
 * @param {Object} client
 * @param {string} postId
 * @param {string} token
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function renderChangesForm_(client, postId, token) {
  var post = dsGetPostById(postId);
  if (!post) {
    return renderMessagePage_('Post not found',
      'We could not find that post. It may have been removed.', false);
  }
  // Uses google.script.run (async) instead of a form POST to avoid the
  // "refused to connect" error caused by GAS's post-submit redirect.
  var html = '' +
    pageShell_('Request Changes — IES-TEXA',
      '<h1 style="font-size:24px;margin:0 0 6px 0;">&#128260; Request changes</h1>' +
      '<p style="font-size:16px;color:#555;margin:0 0 20px 0;">Post: <strong>' +
      escapeHtml_(post.Title) + '</strong></p>' +
      '<div id="formArea">' +
      '<label style="display:block;font-size:17px;font-weight:600;margin-bottom:10px;">' +
      'Please describe the changes needed:</label>' +
      '<textarea id="notesArea" rows="6" ' +
      'style="width:100%;box-sizing:border-box;font-size:16px;padding:14px;' +
      'border:2px solid #ccc;border-radius:8px;font-family:inherit;"></textarea>' +
      '<button id="submitBtn" ' +
      'style="margin-top:18px;width:100%;min-height:56px;background:#FF9800;color:#fff;' +
      'border:none;border-radius:8px;font-size:18px;font-weight:700;cursor:pointer;">' +
      'Submit Feedback</button>' +
      '</div>' +
      '<div id="successArea" style="display:none;text-align:center;padding:32px 0;">' +
      '<div style="font-size:48px;margin-bottom:16px;">&#128260;</div>' +
      '<h2 style="font-size:22px;margin:0 0 12px 0;">Mahalo!</h2>' +
      '<p style="font-size:16px;color:#555;">Your feedback has been sent to the team. We\'ll be in touch with revisions.</p>' +
      '</div>' +
      '<script>' +
      'var TOKEN = ' + JSON.stringify(token) + ';' +
      'var POST_ID = ' + JSON.stringify(postId) + ';' +
      'document.getElementById("submitBtn").addEventListener("click", function() {' +
      '  var notes = document.getElementById("notesArea").value.trim();' +
      '  if (!notes) { alert("Please describe the changes needed."); return; }' +
      '  var btn = document.getElementById("submitBtn");' +
      '  btn.disabled = true; btn.style.opacity = "0.5"; btn.textContent = "Submitting...";' +
      '  google.script.run' +
      '    .withSuccessHandler(function() {' +
      '      document.getElementById("formArea").style.display = "none";' +
      '      document.getElementById("successArea").style.display = "block";' +
      '    })' +
      '    .withFailureHandler(function(err) {' +
      '      btn.disabled = false; btn.style.opacity = ""; btn.textContent = "Submit Feedback";' +
      '      alert("Something went wrong. Please try again.");' +
      '    })' +
      '    .api_clientSubmitDecision(TOKEN, POST_ID, "changes", notes);' +
      '});' +
      '<\/script>');
  return HtmlService.createHtmlOutput(html)
    .setTitle('Request Changes — IES-TEXA')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Handles the POSTed changes form.
 * @param {Object} params - token, post, notes
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function handleChangesFormSubmit_(params) {
  var client = dsGetClientByToken(params.token || '');
  if (!client) {
    return renderMessagePage_('Link not valid',
      'This review link is no longer valid. Please contact Anthology FINN Partners.', false);
  }
  var post = dsGetPostById(params.post || '');
  if (!post) {
    return renderMessagePage_('Post not found',
      'We could not find that post. It may have been removed.', false);
  }
  var notes = String(params.notes || '').trim();
  processClientDecision_(client, post.ID,
    CONFIG.APPROVAL_STATUSES.CHANGES_REQUESTED, notes);
  return renderMessagePage_('Your feedback has been sent.',
    'We\'ll follow up with revisions. Mahalo!', true);
}

// ---------------------------------------------------------------------------
// Decision processing (shared by portal + email links)
// ---------------------------------------------------------------------------

/**
 * Records a client decision, writes comments, advances status, and
 * notifies the agency.
 * @param {Object} client - authorized client row (Email, Access_Level, ...)
 * @param {string} postId
 * @param {string} decision - Approved or Changes_Requested
 * @param {string} notes - optional comment text
 * @param {string} [decidedByName] - self-reported name of whoever actually made the
 *   call, captured on the portal only when the session arrived via a URL-delivered
 *   corporate link. Blank on email-delivered decisions.
 * @param {string} [sourceTag] - optional casual label on the note itself (e.g.
 *   "Legal", "Communications"), same URL-delivered-only scoping as decidedByName.
 * @return {{ok: boolean, message: string, post: Object}}
 */
function processClientDecision_(client, postId, decision, notes, decidedByName, sourceTag) {
  var post = dsGetPostById(postId);
  if (!post) throw new Error('Post not found: ' + postId);

  var stage = accessLevelToStage(client.Access_Level);
  var expectedStatus = accessLevelToStatus(client.Access_Level);
  var approverName = dsClientDisplayName(client);

  // Guard: if the post already moved past this stage, treat as already handled.
  if (post.Status !== expectedStatus) {
    return {
      ok: false,
      message: 'This post is no longer awaiting your review (current status: ' +
        escapeHtml_(post.Status.replace(/_/g, ' ')) + '). No action was recorded.',
      post: post
    };
  }

  // Record the decision.
  dsRecordDecision(postId, stage, client.Email, approverName, decision, notes, decidedByName);

  // Save the optional comment as a client-visible comment.
  if (notes) {
    var commentType = client.Access_Level === CONFIG.ACCESS_LEVELS.CORPORATE
      ? CONFIG.COMMENT_TYPES.CORPORATE_REPLY
      : CONFIG.COMMENT_TYPES.CLIENT_REPLY;
    dsAddComment(postId, client.Email, approverName, notes, commentType, sourceTag);
  }

  // Advance or roll back status.
  if (decision === CONFIG.APPROVAL_STATUSES.APPROVED) {
    if (dsStageApproved(postId, stage)) {
      var nextStatus = nextStatusAfterApproval(post.Status);
      if (nextStatus) {
        dsUpdatePostStatus(postId, nextStatus, client.Email);
        // When local approves and post advances to Awaiting_Corporate,
        // pre-populate corporate approval records and queue notifications.
        // The post sits in Awaiting_Corporate until agency OR local clicks
        // "Send to Corporate" in their respective toolbar.
        if (nextStatus === CONFIG.STATUSES.AWAITING_CORPORATE) {
          // Deduplicate: clear any existing unsent corporate batch notifications
          // for this post before queuing new ones.
          dsClearUnsentBatchNotifications(postId, CONFIG.STAGES.CORPORATE);
          dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.CORPORATE).forEach(function (ap) {
            dsCreatePendingApproval(postId, CONFIG.STAGES.CORPORATE,
              ap.Email, dsClientDisplayName(ap));
            // Queue for batch send — agency or local will trigger the actual email.
            dsQueueNotification(postId, ap.Email, dsClientDisplayName(ap),
              CONFIG.STAGES.CORPORATE, 'batch', 'system');
          });
        } else if (nextStatus === CONFIG.STATUSES.APPROVED) {
          // Stage 3a (2026-07-22): save a permanent copy of the approved media
          // to the app's own Drive folder. Wrapped in try/catch — the decision
          // itself is already recorded at this point (dsUpdatePostStatus above
          // already succeeded), so a Drive-copy hiccup must never surface to
          // the reviewer as if their approval failed. post's media fields are
          // unaffected by the status change above, so the already-fetched
          // `post` object is still accurate to read from.
          try {
            saveApprovedAssetCopies_(post, client.Email);
          } catch (err) {
            console.error('processClientDecision_: permanent-copy save failed for ' +
              postId + ': ' + err.message);
          }
        }
      }
    }
  } else {
    // Changes requested: move post to Revising so it stays visible to clients
    // but is clearly in agency's court. Option B (confirmed by MJ 2026-06-11).
    dsUpdatePostStatus(postId, CONFIG.STATUSES.REVISING, client.Email);
  }

  var updatedPost = dsGetPostById(postId);

  // No immediate per-decision agency email of any kind, approved or changes
  // requested. Everything rides the same batch-and-alert pattern MJ described
  // 2026-07-07: an alert badge shows what's ready, and the reviewer can
  // hit send whenever they want, one post or a full month at once. Corporate's
  // Changes_Requested is covered by the existing corp_batch queue + Send
  // Responses below. Local's Changes_Requested is covered by
  // dsGetPendingLocalChangeRequests, flushed alongside Send to Corporate (see
  // api_localSendToCorporate) or on its own if nothing's pending for corporate.

  // When corporate acts, queue a batched response notification rather than sending
  // immediately. Corporate will click "Send Responses" in their toolbar when they're
  // done reviewing all posts — one digest goes to local + one to agency.
  if (client.Access_Level === CONFIG.ACCESS_LEVELS.CORPORATE) {
    try {
      dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.LOCAL).forEach(function (ap) {
        dsQueueNotification(postId, ap.Email, dsClientDisplayName(ap),
          CONFIG.STAGES.LOCAL_CLIENT, 'corp_batch', client.Email);
      });
    } catch (err) {
      console.error('Corp batch queue failed: ' + err.message);
    }
  }

  return { ok: true, message: 'Decision recorded.', post: updatedPost };
}

// ---------------------------------------------------------------------------
// Agency server APIs (called via google.script.run from Index.html)
// ---------------------------------------------------------------------------

/**
 * Verifies the active user is an authorized agency user; returns the record.
 * @return {Object} user record
 */
function requireAgencyUser_() {
  var email = '';
  try {
    email = Session.getActiveUser().getEmail();
  } catch (err) {
    email = '';
  }
  var user = dsGetUserByEmail(email);
  if (!user) throw new Error('Not authorized. Please sign in with an agency account.');
  return user;
}

/**
 * Returns all posts (agency view).
 * @return {Array<Object>}
 */
function api_getPosts() {
  requireAgencyUser_();
  return dsGetAllPosts();
}

/**
 * Returns full detail for one post: post, approvals, comments.
 * Also returns revisedByCorporate: true when the post is in Revising and the
 * most recent approval was a corporate Changes_Requested — tells the agency
 * dashboard to offer the "Re-send to Corporate" shortcut button.
 * @param {string} postId
 * @return {Object}
 */
function api_getPostDetail(postId) {
  requireAgencyUser_();
  var post = dsGetPostById(postId);
  if (!post) throw new Error('Post not found: ' + postId);
  var approvals = dsGetApprovalsForPost(postId);
  var revisedByCorporate = false;
  if (String(post.Status) === CONFIG.STATUSES.REVISING && approvals.length) {
    var last = approvals[0]; // newest first
    revisedByCorporate = String(last.Stage) === CONFIG.STAGES.CORPORATE &&
      String(last.Approval_Status) === CONFIG.APPROVAL_STATUSES.CHANGES_REQUESTED;
  }
  return {
    post: post,
    approvals: approvals,
    comments: dsGetCommentsForPost(postId),
    revisedByCorporate: revisedByCorporate
  };
}

/**
 * Creates or updates a post.
 * @param {Object} postData - includes ID for updates, blank for create
 * @return {Object} the saved post
 */
function api_savePost(postData) {
  var user = requireAgencyUser_();
  var savedPost;
  if (postData.ID) {
    // Save all editable fields first (dsUpdatePost does NOT touch Status).
    savedPost = dsUpdatePost(postData.ID, postData, user.Email);
    // If Status was included and differs from current, apply status change here
    // so the agency only needs one Save action.
    if (postData.Status && postData.Status !== savedPost.Status) {
      var requestedStatus = postData.Status;
      var level = statusToAccessLevel(requestedStatus);
      // Client review statuses (Local_Client_Review, Corporate_Review) never go
      // live directly from this dropdown — hold the post in the matching
      // Awaiting_ status until the agency explicitly clicks Send. Previously,
      // picking Corporate_Review here (or Local_Client_Review) set the visible
      // status immediately, skipping the Awaiting_Corporate/Awaiting_Local gate
      // and the explicit Send step entirely — a real "client sees something not
      // explicitly approved" gap. Fixed 2026-07-09.
      var actualStatus = level ? (awaitingStatusFor_(requestedStatus) || requestedStatus) : requestedStatus;
      savedPost = dsUpdatePostStatus(postData.ID, actualStatus, user.Email);
      // For client review stages: create pending approvals + queue batch notification.
      if (level) {
        var stage = accessLevelToStage(level);
        // Deduplicate: clear any existing unsent batch notifications for this post+stage
        // before queuing new ones (handles status going backwards or re-sends).
        dsClearUnsentBatchNotifications(postData.ID, stage);
        dsGetAuthorizedClients(level).forEach(function (ap) {
          dsCreatePendingApproval(postData.ID, stage, ap.Email, dsClientDisplayName(ap));
          dsQueueNotification(postData.ID, ap.Email, dsClientDisplayName(ap),
            stage, 'batch', user.Email);
        });
      } else if (requestedStatus === CONFIG.STATUSES.INTERNAL) {
        dsCreatePendingApproval(postData.ID, CONFIG.STAGES.INTERNAL,
          user.Email, user.Full_Name || user.Email);
      }
    }
  } else {
    savedPost = dsCreatePost(postData, user.Email);
  }
  return savedPost;
}

/**
 * Changes a post's status. If the new status is a client review stage,
 * creates Pending approval records for the selected (or all) approvers.
 * @param {string} postId
 * @param {string} newStatus
 * @return {Object} the updated post
 */
function api_changeStatus(postId, newStatus) {
  var user = requireAgencyUser_();
  var post = dsUpdatePostStatus(postId, newStatus, user.Email);
  var level = statusToAccessLevel(newStatus);
  if (level) {
    var stage = accessLevelToStage(level);
    dsGetAuthorizedClients(level).forEach(function (ap) {
      dsCreatePendingApproval(postId, stage, ap.Email, dsClientDisplayName(ap));
    });
  } else if (newStatus === CONFIG.STATUSES.INTERNAL) {
    dsCreatePendingApproval(postId, CONFIG.STAGES.INTERNAL, user.Email, user.Full_Name || user.Email);
  }
  return post;
}

/**
 * Sets a post's Deleted/Unpublished retention flag. Stage 3b (2026-07-22).
 * Agency-only, mirrors the confirm-first pattern the front end wraps this in.
 * Does not touch Status or remove the row — see dsSetRetentionStatus.
 * @param {string} postId
 * @param {string} retentionStatus - CONFIG.RETENTION_STATUSES value
 * @return {Object} the updated post
 */
function api_setPostRetention(postId, retentionStatus) {
  var user = requireAgencyUser_();
  var valid = [CONFIG.RETENTION_STATUSES.DELETED, CONFIG.RETENTION_STATUSES.UNPUBLISHED];
  if (valid.indexOf(retentionStatus) === -1) {
    throw new Error('Invalid retention status: ' + retentionStatus);
  }
  return dsSetRetentionStatus(postId, retentionStatus, user.Email);
}

/**
 * Clears a post's Deleted/Unpublished retention flag. Stage 3b add-on
 * (2026-07-22). The row and its Status were never touched by Delete/Unpublish
 * in the first place, so restoring is just clearing the flag back to blank.
 * @param {string} postId
 * @return {Object} the updated post
 */
function api_restorePost(postId) {
  var user = requireAgencyUser_();
  return dsSetRetentionStatus(postId, '', user.Email);
}

/**
 * Returns the approvers (Authorized_Clients) for a target review status.
 * @param {string} status - Local_Client_Review or Corporate_Review
 * @return {Array<Object>} [{ID, Email, Name, Access_Level}]
 */
function api_getApproversForStatus(status) {
  requireAgencyUser_();
  var level = statusToAccessLevel(status);
  if (!level) return [];
  return dsGetAuthorizedClients(level).map(function (ap) {
    return {
      ID: ap.ID,
      Email: ap.Email,
      Name: dsClientDisplayName(ap),
      Access_Level: ap.Access_Level
    };
  });
}

/**
 * Queues notifications for selected approvers.
 * @param {string} postId
 * @param {Array<{Email: string, Name: string}>} approvers
 * @param {string} sendAt - 'now' or an ISO datetime string from datetime-local
 * @return {{queued: number}}
 */
function api_queueNotifications(postId, approvers, sendAt) {
  var user = requireAgencyUser_();
  var post = dsGetPostById(postId);
  if (!post) throw new Error('Post not found: ' + postId);
  var stage = statusToStage(post.Status) ||
    (post.Status === CONFIG.STATUSES.CORPORATE
      ? CONFIG.STAGES.CORPORATE : CONFIG.STAGES.LOCAL_CLIENT);
  var sendAtValue = (sendAt === 'now' || !sendAt) ? 'now' : new Date(sendAt);
  var count = 0;
  (approvers || []).forEach(function (ap) {
    dsQueueNotification(postId, ap.Email, ap.Name, stage, sendAtValue, user.Email);
    count++;
  });
  // Send immediately when requested, instead of waiting for the trigger.
  if (sendAtValue === 'now') {
    try {
      processNotificationQueue();
    } catch (err) {
      console.error('Immediate queue processing failed (trigger will retry): ' + err.message);
    }
  }
  return { queued: count };
}

/**
 * Returns counts of unsent batch notifications split by stage, plus the count
 * of Revising posts that are candidates for direct re-send to corporate.
 * Returns plain primitives only — raw sheet row objects are NOT JSON-serializable by GAS.
 * @return {{localCount: number, corpCount: number, revisingByCorpCount: number}}
 */
function api_getPendingBatch() {
  requireAgencyUser_();
  var unsent = dsGetUnsentNotifications();
  var localCount = 0;
  var corpCount = 0;
  unsent.forEach(function (row) {
    if (String(row.Send_At).toLowerCase() !== 'batch') return;
    var stage = String(row.Stage);
    if (stage === CONFIG.STAGES.LOCAL_CLIENT) localCount++;
    else if (stage === CONFIG.STAGES.CORPORATE) corpCount++;
  });
  // Count posts in Revising that were caused by a corporate Changes_Requested.
  // These can be re-sent directly to corporate, bypassing local re-review.
  var revisingByCorpCount = 0;
  dsGetAllPosts().forEach(function (post) {
    if (String(post.Status) !== CONFIG.STATUSES.REVISING) return;
    var approvals = dsGetApprovalsForPost(post.ID);
    if (!approvals.length) return;
    var last = approvals[0]; // newest first
    if (String(last.Stage) === CONFIG.STAGES.CORPORATE &&
        String(last.Approval_Status) === CONFIG.APPROVAL_STATUSES.CHANGES_REQUESTED) {
      revisingByCorpCount++;
    }
  });
  // Flag when nothing has been sent to corporate in a while, so the agency
  // toolbar can offer to step in if local hasn't gotten to it.
  var corpBatchStaleDays = 0;
  var oldestCorp = dsGetOldestUnsentCorporateBatchDate();
  if (oldestCorp) {
    corpBatchStaleDays = Math.floor((Date.now() - oldestCorp.getTime()) / (24 * 60 * 60 * 1000));
  }

  return {
    localCount: localCount,
    corpCount: corpCount,
    revisingByCorpCount: revisingByCorpCount,
    corpBatchStaleDays: corpBatchStaleDays,
    corpBatchStale: corpBatchStaleDays >= CONFIG.CORP_SEND_STALENESS_DAYS
  };
}

/**
 * Re-sends ALL Revising-by-corporate posts directly to Corporate_Review in one batch.
 * Queues corporate batch notifications, sends a FYI email to local for each post.
 * @return {{ok: boolean, reSentCount: number, message: string}}
 */
function api_agencyReSendAllToCorporate() {
  var user = requireAgencyUser_();
  var reSentCount = 0;
  dsGetAllPosts().forEach(function (post) {
    if (String(post.Status) !== CONFIG.STATUSES.REVISING) return;
    var approvals = dsGetApprovalsForPost(post.ID);
    if (!approvals.length) return;
    var last = approvals[0];
    if (String(last.Stage) !== CONFIG.STAGES.CORPORATE ||
        String(last.Approval_Status) !== CONFIG.APPROVAL_STATUSES.CHANGES_REQUESTED) return;
    try {
      dsUpdatePostStatus(post.ID, CONFIG.STATUSES.CORPORATE, user.Email);
      dsClearUnsentBatchNotifications(post.ID, CONFIG.STAGES.CORPORATE);
      dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.CORPORATE).forEach(function (ap) {
        dsCreatePendingApproval(post.ID, CONFIG.STAGES.CORPORATE, ap.Email, dsClientDisplayName(ap));
        dsQueueNotification(post.ID, ap.Email, dsClientDisplayName(ap),
          CONFIG.STAGES.CORPORATE, 'batch', user.Email);
      });
      // FYI to local — informational, no action required.
      var updatedPost = dsGetPostById(post.ID);
      var localApprovers = dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.LOCAL).map(function (ap) {
        return { Email: ap.Email, Name: dsClientDisplayName(ap) };
      });
      sendLocalCorpReSendFYIEmail(updatedPost, localApprovers);
      reSentCount++;
    } catch (err) {
      console.error('api_agencyReSendAllToCorporate ' + post.ID + ': ' + err.message);
    }
  });
  return {
    ok: true,
    reSentCount: reSentCount,
    message: reSentCount === 0
      ? 'No posts to re-send.'
      : reSentCount + ' post' + (reSentCount !== 1 ? 's' : '') +
        ' sent back to corporate review. Use “Send to Corporate” to send the review email.'
  };
}

/**
 * Builds a corporate approver's portal link.
 * @param {string} token - the approver's Access_Token
 * @param {boolean} [viaUrl] - true to tag this link as hand-delivered through a
 *   non-email channel (e.g. pasted into the client's communications platform),
 *   which flips on the optional source-tag / required decided-by-name fields
 *   in the portal. Omit for the normal email-delivered link.
 * @return {string}
 */
function buildCorporatePortalUrl_(token, viaUrl) {
  var url = CONFIG.APP_URL + '?page=client&token=' + encodeURIComponent(token);
  if (viaUrl) {
    url += '&' + CONFIG.URL_DELIVERY_PARAM + '=' + CONFIG.URL_DELIVERY_VALUE;
  }
  return url;
}

/**
 * Returns corporate approvers who currently have at least one pending (unsent)
 * batch notification, with their default delivery channel. Backs the
 * Send to Corporate picker on both the agency and local portals.
 * @return {Array<{Email: string, Name: string, DefaultChannel: string}>}
 */
function getPendingCorporateApprovers_() {
  var pendingEmails = {};
  dsGetUnsentNotifications().forEach(function (row) {
    if (String(row.Send_At).toLowerCase() === 'batch' &&
        String(row.Stage) === CONFIG.STAGES.CORPORATE) {
      pendingEmails[String(row.Approver_Email).toLowerCase()] = true;
    }
  });
  return dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.CORPORATE)
    .filter(function (ap) { return pendingEmails[String(ap.Email).toLowerCase()]; })
    .map(function (ap) {
      return {
        Email: ap.Email,
        Name: dsClientDisplayName(ap),
        DefaultChannel: ap.Default_Channel || CONFIG.DELIVERY_CHANNELS.EMAIL
      };
    });
}

/**
 * Agency-side: corporate approvers with something pending to send, for the picker.
 * @return {Array<Object>}
 */
function api_getCorporatePendingApprovers() {
  requireAgencyUser_();
  return getPendingCorporateApprovers_();
}

/**
 * Local-side: same list as the agency picker, restricted to Local-access tokens.
 * @param {string} token
 * @return {Array<Object>}
 */
function api_clientGetCorporateApprovers(token) {
  var client = requireClient_(token);
  if (client.Access_Level !== CONFIG.ACCESS_LEVELS.LOCAL) {
    throw new Error('Only local approvers can view this.');
  }
  return getPendingCorporateApprovers_();
}

/**
 * Shared implementation for flushing pending corporate batch notifications.
 * This is the single place that handles recipient selection, delivery channel
 * (email and/or a hand-deliverable portal link), advancing post status, and the
 * FYI notification to whichever side didn't trigger the send. Both the agency
 * "Send to Corporate" button and the local client's "Send to Corporate" action
 * call this, so a change here applies identically to both — nobody has to
 * remember to update two copies of the same logic.
 * @param {Array<{Email:string, ViaEmail:boolean, ViaUrl:boolean}>} [selections] -
 *   which corporate approvers to flush this round and how. Omit to flush every
 *   corporate approver with a pending batch notification via their Default_Channel
 *   (falling back to Email if unset) — the "just send it" default action.
 * @param {{email:string, name:string, role:string}} triggeredBy - role is 'agency' or 'local'.
 * @return {{ok: boolean, sent: number, errors: number, links: Array<{Email:string, Name:string, Url:string}>}}
 */
function sendCorporateBatch_(selections, triggeredBy) {
  var unsent = dsGetUnsentNotifications().filter(function (row) {
    return String(row.Send_At).toLowerCase() === 'batch' &&
           String(row.Stage) === CONFIG.STAGES.CORPORATE;
  });
  if (!unsent.length) {
    return { ok: true, sent: 0, errors: 0, links: [] };
  }

  var allApprovers = dsGetAuthorizedClients();
  var approverLookup = {};
  allApprovers.forEach(function (ap) {
    approverLookup[String(ap.Email).toLowerCase()] = ap;
  });

  // Build the selection map. No selections passed => everyone pending, via their default.
  var selectionMap = {};
  if (selections && selections.length) {
    selections.forEach(function (s) {
      selectionMap[String(s.Email).toLowerCase()] = {
        viaEmail: !!s.ViaEmail,
        viaUrl: !!s.ViaUrl
      };
    });
  } else {
    var pendingEmails = {};
    unsent.forEach(function (row) { pendingEmails[String(row.Approver_Email).toLowerCase()] = true; });
    Object.keys(pendingEmails).forEach(function (email) {
      var ap = approverLookup[email];
      var def = ap ? String(ap.Default_Channel || '') : '';
      selectionMap[email] = {
        viaEmail: def !== CONFIG.DELIVERY_CHANNELS.URL,
        viaUrl: def === CONFIG.DELIVERY_CHANNELS.URL || def === CONFIG.DELIVERY_CHANNELS.BOTH
      };
    });
  }

  // Only process rows for approvers selected this round. Everyone else's
  // notifications stay queued, unsent, for a future send.
  var byApprover = {};
  unsent.forEach(function (row) {
    var key = String(row.Approver_Email).toLowerCase();
    if (!selectionMap[key]) return;
    if (!byApprover[key]) {
      byApprover[key] = { rows: [], posts: [], approver: approverLookup[key] || null, name: row.Approver_Name };
    }
    byApprover[key].rows.push(row);
  });

  // Advance Awaiting_Corporate posts referenced by the selected rows.
  var advancedIds = {};
  Object.keys(byApprover).forEach(function (key) {
    byApprover[key].rows.forEach(function (row) {
      var pid = row.Post_ID;
      if (advancedIds[pid]) return;
      var post = dsGetPostById(pid);
      if (post && String(post.Status) === CONFIG.STATUSES.AWAITING_CORPORATE) {
        try {
          dsUpdatePostStatus(pid, CONFIG.STATUSES.CORPORATE, triggeredBy.email);
          advancedIds[pid] = true;
        } catch (err) {
          console.error('sendCorporateBatch_: failed to advance ' + pid + ': ' + err.message);
        }
      }
    });
  });

  // Re-fetch posts after the status advance so emails/links reflect it.
  Object.keys(byApprover).forEach(function (key) {
    byApprover[key].rows.forEach(function (row) {
      var fresh = dsGetPostById(row.Post_ID);
      if (fresh) byApprover[key].posts.push(fresh);
    });
  });

  var sent = 0;
  var errors = 0;
  var links = [];

  Object.keys(byApprover).forEach(function (key) {
    var data = byApprover[key];
    var selection = selectionMap[key] || { viaEmail: true, viaUrl: false };
    if (!data.posts.length || !data.approver) {
      data.rows.forEach(function (r) { dsMarkNotificationSent(r.ID); });
      return;
    }
    var approverName = data.name || dsClientDisplayName(data.approver);
    var channelLabel = (selection.viaEmail && selection.viaUrl)
      ? CONFIG.DELIVERY_CHANNELS.BOTH
      : (selection.viaUrl ? CONFIG.DELIVERY_CHANNELS.URL : CONFIG.DELIVERY_CHANNELS.EMAIL);
    var emailOk = true;

    if (selection.viaEmail) {
      try {
        sendClientDigestEmail({
          Email: data.approver.Email,
          Name: approverName,
          Access_Token: data.approver.Access_Token
        }, data.posts);
        data.rows.forEach(function (r) { dsMarkApprovalEmailSent(r.Post_ID, r.Stage, data.approver.Email); });
      } catch (err) {
        console.error('sendCorporateBatch_ email ' + key + ': ' + err.message);
        emailOk = false;
      }
    }

    if (selection.viaUrl) {
      links.push({
        Email: data.approver.Email,
        Name: approverName,
        Url: buildCorporatePortalUrl_(data.approver.Access_Token, true)
      });
    }

    if (emailOk) {
      data.rows.forEach(function (r) { dsMarkNotificationSent(r.ID, channelLabel); });
      sent += data.rows.length;
    } else {
      errors += data.rows.length;
    }
  });

  // FYI to whichever side didn't trigger this send.
  if (sent > 0) {
    try {
      var sentPosts = [];
      var seen = {};
      Object.keys(byApprover).forEach(function (k) {
        (byApprover[k].posts || []).forEach(function (p) {
          if (!seen[p.ID]) { seen[p.ID] = true; sentPosts.push(p); }
        });
      });
      if (sentPosts.length) {
        if (triggeredBy.role === 'local') {
          sendAgencyCorpSentFYIEmail(sentPosts, triggeredBy.name);
        } else {
          var localFYIApprovers = dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.LOCAL).map(function (ap) {
            return { Email: ap.Email, Name: dsClientDisplayName(ap), Access_Token: ap.Access_Token };
          });
          sendLocalCorpBatchFYIEmail(localFYIApprovers, sentPosts);
        }
      }
    } catch (err) {
      console.error('sendCorporateBatch_: FYI failed: ' + err.message);
    }
  }

  return { ok: true, sent: sent, errors: errors, links: links };
}

/**
 * Agency-side entry point for the Send to Corporate picker.
 * @param {Array<{Email:string, ViaEmail:boolean, ViaUrl:boolean}>} [selections]
 * @return {{ok: boolean, sent: number, errors: number, links: Array<Object>}}
 */
function api_sendCorporateBatch(selections) {
  var user = requireAgencyUser_();
  return sendCorporateBatch_(selections, {
    email: user.Email,
    name: user.Full_Name || user.Email,
    role: 'agency'
  });
}

/**
 * Returns Local-access approvers who currently have a pending batch notification.
 * Backs the agency's Local Client send picker (e.g. so MJ can test against just
 * her own account without removing Ali from Authorized_Clients).
 * @return {Array<{Email: string, Name: string}>}
 */
function api_getLocalPendingApprovers() {
  requireAgencyUser_();
  var pendingEmails = {};
  dsGetUnsentNotifications().forEach(function (row) {
    if (String(row.Send_At).toLowerCase() === 'batch' &&
        String(row.Stage) === CONFIG.STAGES.LOCAL_CLIENT) {
      pendingEmails[String(row.Approver_Email).toLowerCase()] = true;
    }
  });
  return dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.LOCAL)
    .filter(function (ap) { return pendingEmails[String(ap.Email).toLowerCase()]; })
    .map(function (ap) {
      return { Email: ap.Email, Name: dsClientDisplayName(ap) };
    });
}

/**
 * Sends batch-queued Local_Client notifications as a DIGEST — one email per
 * approver covering all their pending posts. Corporate sends always go through
 * api_sendCorporateBatch / sendCorporateBatch_ instead, since that path is
 * recipient- and channel-aware; this function only ever handles Local_Client.
 * @param {string} [stage] - CONFIG.STAGES value. Defaults to Local_Client.
 * @param {Array<string>} [selectedEmails] - restrict the send to these approver
 *   emails. Omit to send to everyone with a pending notification (unchanged
 *   default behavior).
 * @return {{sent: number, errors: number}}
 */
function api_sendBatch(stage, selectedEmails) {
  var user = requireAgencyUser_();
  var targetStage = stage || CONFIG.STAGES.LOCAL_CLIENT;
  var selectedSet = null;
  if (selectedEmails && selectedEmails.length) {
    selectedSet = {};
    selectedEmails.forEach(function (e) { selectedSet[String(e).toLowerCase()] = true; });
  }
  var unsent = dsGetUnsentNotifications();
  var batch = unsent.filter(function (row) {
    if (String(row.Send_At).toLowerCase() !== 'batch') return false;
    if (String(row.Stage) !== targetStage) return false;
    if (selectedSet && !selectedSet[String(row.Approver_Email).toLowerCase()]) return false;
    return true;
  });

  // Advance Awaiting_Local posts referenced by this batch to Local_Client_Review —
  // this is the explicit Send action that makes them visible to Local, mirroring
  // sendCorporateBatch_'s Awaiting_Corporate -> Corporate_Review advance. Without
  // this step the post never left Awaiting_Local and Local would never see it.
  // Added 2026-07-09 alongside the Awaiting_Local gate itself.
  if (targetStage === CONFIG.STAGES.LOCAL_CLIENT) {
    var advancedLocalIds_ = {};
    batch.forEach(function (row) {
      var pid = row.Post_ID;
      if (advancedLocalIds_[pid]) return;
      var post = dsGetPostById(pid);
      if (post && String(post.Status) === CONFIG.STATUSES.AWAITING_LOCAL) {
        try {
          dsUpdatePostStatus(pid, CONFIG.STATUSES.LOCAL_CLIENT, user.Email);
          advancedLocalIds_[pid] = true;
        } catch (err) {
          console.error('api_sendBatch: failed to advance ' + pid + ': ' + err.message);
        }
      }
    });
  }

  // Group rows by approver email so each person gets exactly one digest email.
  var byApprover = {};
  var allApprovers = dsGetAuthorizedClients();
  var approverLookup = {};
  allApprovers.forEach(function (ap) {
    approverLookup[String(ap.Email).toLowerCase()] = ap;
  });

  batch.forEach(function (row) {
    var key = String(row.Approver_Email).toLowerCase();
    if (!byApprover[key]) {
      byApprover[key] = { rows: [], posts: [], approver: null, name: row.Approver_Name };
    }
    byApprover[key].rows.push(row);
    if (!byApprover[key].approver) {
      byApprover[key].approver = approverLookup[key] || null;
    }
    var post = dsGetPostById(row.Post_ID);
    if (post) byApprover[key].posts.push(post);
  });

  var sent = 0;
  var errors = 0;

  Object.keys(byApprover).forEach(function (key) {
    var data = byApprover[key];
    if (!data.posts.length || !data.approver) {
      data.rows.forEach(function (r) { dsMarkNotificationSent(r.ID); });
      return;
    }
    try {
      var freshPosts = data.posts.map(function (p) {
        return dsGetPostById(p.ID) || p;
      });
      sendClientDigestEmail({
        Email: data.approver.Email,
        Name: data.name || dsClientDisplayName(data.approver),
        Access_Token: data.approver.Access_Token
      }, freshPosts);
      data.rows.forEach(function (r) {
        dsMarkApprovalEmailSent(r.Post_ID, r.Stage, data.approver.Email);
        dsMarkNotificationSent(r.ID);
      });
      sent += data.rows.length;
    } catch (err) {
      console.error('api_sendBatch approver ' + key + ': ' + err.message);
      errors += data.rows.length;
    }
  });

  return { sent: sent, errors: errors };
}

/**
 * Adds an agency comment to a post.
 * @param {string} postId
 * @param {string} text
 * @param {string} type - Internal, Client_Reply (the Local conversation), or
 *   Corporate_Reply (the Corporate conversation). Any other value falls back to
 *   Internal, so a bad or missing type can never leak text into a client thread.
 * @return {Object} the created comment
 */
function api_addComment(postId, text, type) {
  var user = requireAgencyUser_();
  // Agency may post into either client conversation (Local or Corporate) or keep
  // it internal. Stage 1 (2026-07-21) added Corporate_Reply as a valid target so
  // the agency can reply directly into the Corporate conversation.
  var clientScopes = [CONFIG.COMMENT_TYPES.CLIENT_REPLY,
                      CONFIG.COMMENT_TYPES.CORPORATE_REPLY];
  var safeType = (clientScopes.indexOf(type) !== -1)
    ? type
    : CONFIG.COMMENT_TYPES.INTERNAL;
  return dsAddComment(postId, user.Email, user.Full_Name || user.Email,
    String(text || '').trim(), safeType);
}

/**
 * Agency shortcut: re-sends a Revising post directly to Corporate_Review,
 * bypassing local re-review. Only works when the Revising was caused by a
 * corporate Changes_Requested decision. Queues batch notifications for
 * corporate and immediately sends a FYI email to local approvers.
 * @param {string} postId
 * @return {{ok: boolean, message: string}}
 */
function api_agencyReSendToCorporate(postId) {
  var user = requireAgencyUser_();
  var post = dsGetPostById(postId);
  if (!post) throw new Error('Post not found: ' + postId);

  // Guard: post must be in Revising.
  if (String(post.Status) !== CONFIG.STATUSES.REVISING) {
    return { ok: false, message: 'Post is not in Revising status.' };
  }

  // Guard: Revising must have been caused by corporate, not local.
  var approvals = dsGetApprovalsForPost(postId);
  var last = approvals[0]; // newest first
  if (!last ||
      String(last.Stage) !== CONFIG.STAGES.CORPORATE ||
      String(last.Approval_Status) !== CONFIG.APPROVAL_STATUSES.CHANGES_REQUESTED) {
    return {
      ok: false,
      message: 'This post was not sent to Revising by corporate — use the normal workflow.'
    };
  }

  // Advance to Corporate_Review.
  dsUpdatePostStatus(postId, CONFIG.STATUSES.CORPORATE, user.Email);

  // Clear any stale corporate batch notifications and re-queue fresh ones.
  dsClearUnsentBatchNotifications(postId, CONFIG.STAGES.CORPORATE);
  dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.CORPORATE).forEach(function (ap) {
    dsCreatePendingApproval(postId, CONFIG.STAGES.CORPORATE, ap.Email, dsClientDisplayName(ap));
    dsQueueNotification(postId, ap.Email, dsClientDisplayName(ap),
      CONFIG.STAGES.CORPORATE, 'batch', user.Email);
  });

  // Immediately notify local approvers with an FYI (not batched — no action required).
  try {
    var updatedPost = dsGetPostById(postId);
    var localApprovers = dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.LOCAL).map(function (ap) {
      return { Email: ap.Email, Name: dsClientDisplayName(ap) };
    });
    sendLocalCorpReSendFYIEmail(updatedPost, localApprovers);
  } catch (err) {
    console.error('api_agencyReSendToCorporate: FYI email failed: ' + err.message);
  }

  return {
    ok: true,
    message: 'Post sent back to corporate review. Local client notified. Use "Send to Corporate" in the toolbar to send the review request email.'
  };
}

// ---------------------------------------------------------------------------
// Client portal server APIs (called via google.script.run from ClientPortal.html)
// ---------------------------------------------------------------------------

/**
 * Validates a token and returns the client record (throws if invalid).
 * @param {string} token
 * @return {Object}
 */
function requireClient_(token) {
  var client = dsGetClientByToken(token);
  if (!client) throw new Error('This review link is no longer valid.');
  return client;
}

/**
 * Returns the client's review queue: all posts in their stage.
 * @param {string} token
 * @return {Array<Object>} posts (no Internal_Notes)
 */
function api_clientGetQueue(token) {
  var client = requireClient_(token);
  var status = accessLevelToStatus(client.Access_Level);
  return dsGetAllPosts()
    .filter(function (p) { return p.Status === status; })
    .map(stripInternalFields_);
}

/**
 * Returns all posts visible to a client based on their access level.
 * Local: Local_Client_Review, Revising, Corporate_Review, Approved, Published.
 * Corporate: Corporate_Review, Approved, Published.
 * @param {string} token
 * @return {Array<Object>}
 */
function api_clientGetAllPosts(token) {
  var client = requireClient_(token);
  var isCorp = client.Access_Level === CONFIG.ACCESS_LEVELS.CORPORATE;

  // For corporate: build a lookup of post IDs that have at least one Corporate-stage
  // approval record. Revising posts are only visible to corporate if they actually
  // submitted a decision on that post — prevents posts that Local Client sent back
  // for revisions from leaking into the corporate portal.
  var corpReviewedIds = null;
  if (isCorp) {
    corpReviewedIds = {};
    var approvalData = readSheet_(CONFIG.SHEETS.APPROVALS);
    approvalData.rows.forEach(function (r) {
      if (String(r.Stage) === CONFIG.STAGES.CORPORATE) {
        corpReviewedIds[String(r.Post_ID)] = true;
      }
    });
  }

  var visible = isCorp
    // Corporate sees: their review queue plus final states.
    // Revising is added selectively below (only posts corporate has already reviewed).
    ? [CONFIG.STATUSES.CORPORATE, CONFIG.STATUSES.APPROVED, CONFIG.STATUSES.PUBLISHED]
    // Local sees: their own queue, Awaiting_Corporate (so they can trigger the send),
    // Revising, and all downstream states.
    : [CONFIG.STATUSES.LOCAL_CLIENT, CONFIG.STATUSES.REVISING,
       CONFIG.STATUSES.AWAITING_CORPORATE, CONFIG.STATUSES.CORPORATE,
       CONFIG.STATUSES.APPROVED, CONFIG.STATUSES.PUBLISHED];
  var allowed = {};
  visible.forEach(function (s) { allowed[s] = true; });

  return dsGetAllPosts()
    .filter(function (p) {
      if (p.Status === CONFIG.STATUSES.REVISING && isCorp) {
        // Only show corporate a Revising post if they submitted a decision on it.
        return !!(corpReviewedIds && corpReviewedIds[p.ID]);
      }
      return !!allowed[p.Status];
    })
    .map(stripInternalFields_);
}

/**
 * Returns count of posts in Awaiting_Corporate with unsent corporate notifications.
 * Used by the Local portal toolbar badge.
 * @param {string} token - local client token
 * @return {{awaitingCorpCount: number}}
 */
function api_localGetPendingCorpCount(token) {
  requireClient_(token);
  var count = dsGetUnsentNotifications().filter(function (row) {
    return String(row.Send_At).toLowerCase() === 'batch' &&
           String(row.Stage) === CONFIG.STAGES.CORPORATE;
  }).length;
  return { awaitingCorpCount: count };
}

/**
 * Returns the count of pending Changes_Requested decisions awaiting an agency
 * notification. Used alongside api_localGetPendingCorpCount to build the
 * local portal's combined "ready to send" badge.
 * @param {string} token - local client token
 * @return {{pendingChangesCount: number}}
 */
function api_localGetPendingChangesCount(token) {
  var client = requireClient_(token);
  if (client.Access_Level !== CONFIG.ACCESS_LEVELS.LOCAL) return { pendingChangesCount: 0 };
  return { pendingChangesCount: dsGetPendingLocalChangeRequests().length };
}

/**
 * Local portal: sends pending Awaiting_Corporate notifications to Corporate_Review.
 * Delegates to sendCorporateBatch_, the same function the agency's Send to
 * Corporate button uses, so recipient selection and channel handling behave
 * identically regardless of who triggers the send.
 *
 * Also flushes any pending Changes_Requested notices to agency in the same
 * click, so local never needs a second button for that (MJ 2026-07-07:
 * changes requested rides the same batch, but still works as a one-off send
 * at any time). This runs even if there's nothing pending for corporate.
 * @param {string} token - local client token
 * @param {Array<{Email:string, ViaEmail:boolean, ViaUrl:boolean}>} [selections] -
 *   omit to send to everyone pending via their default channel.
 * @return {{ok: boolean, sent: number, errors: number, links: Array<Object>, changesNotified: number}}
 */
function api_localSendToCorporate(token, selections) {
  var client = requireClient_(token);
  if (client.Access_Level !== CONFIG.ACCESS_LEVELS.LOCAL) {
    throw new Error('Only local approvers can trigger this action.');
  }
  var triggeredBy = {
    email: client.Email,
    name: dsClientDisplayName(client),
    role: 'local'
  };
  var result = sendCorporateBatch_(selections, triggeredBy);
  result.changesNotified = 0;

  var pendingChanges = dsGetPendingLocalChangeRequests();
  if (pendingChanges.length) {
    try {
      var items = pendingChanges.map(function (r) {
        return { post: dsGetPostById(r.Post_ID), notes: r.Decision_Notes };
      }).filter(function (i) { return !!i.post; });
      if (items.length) {
        sendAgencyLocalChangesFYIEmail(items, triggeredBy.name);
        dsMarkChangeRequestsNotified(pendingChanges.map(function (r) { return r.ID; }));
        result.changesNotified = items.length;
      }
    } catch (err) {
      console.error('api_localSendToCorporate: changes-requested FYI failed: ' + err.message);
    }
  }
  return result;
}

/**
 * Returns the count of unsent corporate response notifications (corp_batch).
 * Used by the Corporate portal toolbar badge.
 * @param {string} token - corporate client token
 * @return {{pendingCount: number}}
 */
function api_corporateGetPendingBatchCount(token) {
  var client = requireClient_(token);
  if (client.Access_Level !== CONFIG.ACCESS_LEVELS.CORPORATE) {
    return { pendingCount: 0 };
  }
  // Count distinct posts with unsent corp_batch notifications.
  var seen = {};
  dsGetUnsentNotifications().forEach(function (row) {
    if (String(row.Send_At).toLowerCase() === 'corp_batch') {
      seen[row.Post_ID] = true;
    }
  });
  return { pendingCount: Object.keys(seen).length };
}

/**
 * Corporate portal: sends all pending corp_batch responses as a digest to local
 * approvers and agency. Called when corporate clicks "Send Responses" in the toolbar.
 * @param {string} token - corporate client token
 * @return {{ok: boolean, sent: number, errors: number}}
 */
function api_corporateSendBatch(token) {
  var client = requireClient_(token);
  if (client.Access_Level !== CONFIG.ACCESS_LEVELS.CORPORATE) {
    throw new Error('Only corporate approvers can trigger this action.');
  }

  var pending = dsGetUnsentNotifications().filter(function (row) {
    return String(row.Send_At).toLowerCase() === 'corp_batch';
  });

  if (!pending.length) {
    return { ok: true, sent: 0, errors: 0 };
  }

  // Deduplicate by post and build decisions array.
  var decisionsByPost = {};
  pending.forEach(function (row) {
    if (!decisionsByPost[row.Post_ID]) {
      decisionsByPost[row.Post_ID] = { rows: [], post: null, decision: null };
    }
    decisionsByPost[row.Post_ID].rows.push(row);
  });

  var decisions = [];
  Object.keys(decisionsByPost).forEach(function (postId) {
    var post = dsGetPostById(postId);
    if (!post) return;
    // Find the most recent corporate approval record for this post.
    var approvals = dsGetApprovalsForPost(postId).filter(function (a) {
      return String(a.Stage) === CONFIG.STAGES.CORPORATE;
    });
    if (!approvals.length) return;
    var latest = approvals[0]; // newest first
    decisions.push({
      post: post,
      approverName: String(latest.Approver_Name || latest.Approver_Email || 'Corporate'),
      decision: String(latest.Approval_Status),
      // Fixed 2026-07-21: was latest.Notes, but the Post_Approvals column is
      // actually named Decision_Notes (see dsRecordDecision) — Notes was always
      // undefined, so a reviewer's comment never appeared in this digest at all.
      notes: String(latest.Decision_Notes || '')
    });
    decisionsByPost[postId].post = post;
  });

  var errors = 0;

  // Send digest to each local approver.
  try {
    var localApprovers = dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.LOCAL).map(function (ap) {
      return { Email: ap.Email, Name: dsClientDisplayName(ap), Access_Token: ap.Access_Token };
    });
    sendCorporateBatchResultsEmail(localApprovers, decisions, false);
  } catch (err) {
    console.error('api_corporateSendBatch: local email failed: ' + err.message);
    errors++;
  }

  // Send digest to agency.
  try {
    sendCorporateBatchResultsEmail(
      CONFIG.AGENCY_NOTIFICATION_EMAILS.map(function (e) { return { Email: e }; }),
      decisions,
      true
    );
  } catch (err) {
    console.error('api_corporateSendBatch: agency email failed: ' + err.message);
    errors++;
  }

  // Mark all pending corp_batch notifications as sent.
  pending.forEach(function (row) {
    try { dsMarkNotificationSent(row.ID); } catch (e) {}
  });

  console.log('api_corporateSendBatch: sent digest for ' + decisions.length + ' post(s)');
  return { ok: true, sent: decisions.length, errors: errors };
}

/**
 * Returns one post (sanitized) plus its client-visible comments.
 * Comment filter: Corporate sees Corporate_Reply only.
 *                 Local sees Client_Reply + Corporate_Reply.
 * @param {string} token
 * @param {string} postId
 * @return {Object}
 */
function api_clientGetPost(token, postId) {
  var client = requireClient_(token);
  var post = dsGetPostById(postId);
  // Treat a real-but-not-visible post the same as a nonexistent one — don't
  // give a client any signal (via a different error message) that a hidden
  // post ID is valid. Fixed 2026-07-09: this function previously had no
  // visibility check at all, so any client with a valid token could fetch
  // full post detail for ANY post ID regardless of status (e.g. a Draft that
  // was never sent to them), by guessing/reusing a sequential POST-### id.
  // Decisions were already safely blocked in processClientDecision_ (it checks
  // post.Status === expectedStatus before recording anything), so this was a
  // read-only exposure, not an approval-integrity one — but MJ's rule is
  // clients "cannot see anything we don't explicitly approve," and this let
  // them see it, just not act on it.
  if (!post || !isPostVisibleToClient_(post, client)) throw new Error('Post not found.');
  // Comment scoping (Stage 1, 2026-07-21) — ASYMMETRIC visibility:
  //   Corporate reviewer   -> ONLY the Corporate conversation (Corporate_Reply).
  //                           Never sees the local thread. This protects the local
  //                           reviewer's candor and is the behavior fixed here.
  //                           Previously Corporate saw the full non-internal thread.
  //   Local reviewer (Ali) -> BOTH the Local conversation (Client_Reply) and the
  //                           Corporate conversation, because she is the liaison to
  //                           Corporate. Unchanged from prior behavior.
  //   Internal comments stay hidden from all clients.
  var isCorp = client.Access_Level === CONFIG.ACCESS_LEVELS.CORPORATE;
  var comments = dsGetCommentsForPost(postId).filter(function (c) {
    if (c.Comment_Type === CONFIG.COMMENT_TYPES.CORPORATE_REPLY) return true;
    // The local conversation is visible to the local reviewer only.
    return !isCorp && c.Comment_Type === CONFIG.COMMENT_TYPES.CLIENT_REPLY;
  });
  var canUndo = checkCanUndo_(client, post);
  return { post: stripInternalFields_(post), comments: comments, canUndo: canUndo };
}

/**
 * Returns whether a client (at their access level) is allowed to see a post
 * given its current status. Single-post counterpart to the status whitelist
 * inside api_clientGetAllPosts — kept as a separate, self-contained check
 * (rather than refactoring the bulk list endpoint) to avoid touching that
 * already-verified corporate Revising-visibility logic from 2026-06-23.
 * @param {Object} post
 * @param {Object} client - Authorized_Clients row
 * @return {boolean}
 */
function isPostVisibleToClient_(post, client) {
  var isCorp = client.Access_Level === CONFIG.ACCESS_LEVELS.CORPORATE;
  if (post.Status === CONFIG.STATUSES.REVISING && isCorp) {
    // Only visible to corporate if they've already submitted a decision at their stage —
    // same rule as api_clientGetAllPosts, checked directly against this one post's
    // approval history instead of a precomputed bulk lookup.
    return dsGetApprovalsForPost(post.ID).some(function (a) {
      return String(a.Stage) === CONFIG.STAGES.CORPORATE;
    });
  }
  var visible = isCorp
    ? [CONFIG.STATUSES.CORPORATE, CONFIG.STATUSES.APPROVED, CONFIG.STATUSES.PUBLISHED]
    : [CONFIG.STATUSES.LOCAL_CLIENT, CONFIG.STATUSES.REVISING,
       CONFIG.STATUSES.AWAITING_CORPORATE, CONFIG.STATUSES.CORPORATE,
       CONFIG.STATUSES.APPROVED, CONFIG.STATUSES.PUBLISHED];
  return visible.indexOf(post.Status) !== -1;
}

/**
 * Determines whether a client can undo their last decision on a post.
 * Checks the approval table to ensure it was THIS client's action that caused
 * the current status (important for Revising, which can be caused by either tier).
 * @param {Object} client
 * @param {Object} post
 * @return {boolean}
 */
function checkCanUndo_(client, post) {
  var isCorp = client.Access_Level === CONFIG.ACCESS_LEVELS.CORPORATE;
  var stage = accessLevelToStage(client.Access_Level);

  // Determine which post statuses are undoable for each tier
  var undoableStatuses = isCorp
    ? [CONFIG.STATUSES.REVISING, CONFIG.STATUSES.APPROVED]
    : [CONFIG.STATUSES.CORPORATE, CONFIG.STATUSES.REVISING];

  if (undoableStatuses.indexOf(post.Status) === -1) return false;

  // For Revising specifically: either tier could have caused it, so verify
  // this client's most recent decision at their stage was Changes_Requested.
  if (post.Status === CONFIG.STATUSES.REVISING) {
    var approvals = dsGetApprovalsForPost(post.ID)
      .filter(function (a) { return String(a.Stage) === stage; });
    if (!approvals.length) return false;
    // dsGetApprovalsForPost returns newest first
    var latest = approvals[0];
    if (String(latest.Approver_Email).toLowerCase() !== String(client.Email).toLowerCase()) return false;
    return String(latest.Approval_Status) === CONFIG.APPROVAL_STATUSES.CHANGES_REQUESTED;
  }

  return true;
}

/**
 * Reverses a client's most recent decision on a post.
 * Reverts post status to the client's review stage and re-creates the pending
 * approval record so they can act again.
 * @param {string} token
 * @param {string} postId
 * @return {{ok: boolean, message: string}}
 */
function api_clientUndoDecision(token, postId) {
  var client = requireClient_(token);
  var post = dsGetPostById(postId);
  if (!post) throw new Error('Post not found.');

  // Re-validate — state may have changed since the panel was opened.
  if (!checkCanUndo_(client, post)) {
    return { ok: false, message: 'This decision can no longer be undone.' };
  }

  var isCorp = client.Access_Level === CONFIG.ACCESS_LEVELS.CORPORATE;
  var stage = accessLevelToStage(client.Access_Level);
  var expectedStatus = accessLevelToStatus(client.Access_Level);

  // Revert post to the client's review stage.
  dsUpdatePostStatus(postId, expectedStatus, client.Email);

  // If local had approved (post was in Corporate_Review), clear any unsent
  // corporate batch notifications — the post is no longer heading to corporate.
  if (!isCorp && post.Status === CONFIG.STATUSES.CORPORATE) {
    dsClearUnsentBatchNotifications(postId, CONFIG.STAGES.CORPORATE);
  }

  // Re-create the Pending approval record so this client can act again.
  dsCreatePendingApproval(postId, stage, client.Email, dsClientDisplayName(client));

  // Notify the agency.
  try {
    var updatedPost = dsGetPostById(postId);
    sendAgencyActionEmail(updatedPost, dsClientDisplayName(client), 'undo',
      'Reviewer reversed their previous decision.');
  } catch (err) {
    console.error('Undo agency notification failed: ' + err.message);
  }

  return { ok: true, message: 'Decision reversed. You can now re-review this post.' };
}

/**
 * Adds a comment from a client user. Type is set based on access level.
 * @param {string} token
 * @param {string} postId
 * @param {string} commentText
 * @param {string} [sourceTag] - optional self-reported source (e.g. "Legal",
 *   "Communications"), only ever sent by the portal when the session arrived
 *   via a URL-delivered corporate link.
 * @return {{ok: boolean}}
 */
function api_clientAddComment(token, postId, commentText, sourceTag) {
  var client = requireClient_(token);
  commentText = String(commentText || '').trim();
  if (!commentText) throw new Error('Comment cannot be empty.');
  var commentType = client.Access_Level === CONFIG.ACCESS_LEVELS.CORPORATE
    ? CONFIG.COMMENT_TYPES.CORPORATE_REPLY
    : CONFIG.COMMENT_TYPES.CLIENT_REPLY;
  dsAddComment(postId, client.Email, dsClientDisplayName(client), commentText, commentType,
    String(sourceTag || '').trim());
  return { ok: true };
}

/**
 * Records a decision from the client portal.
 * @param {string} token
 * @param {string} postId
 * @param {string} decision - 'approve' or 'changes'
 * @param {string} comment
 * @param {string} [decidedByName] - required by the front end on URL-delivered
 *   corporate sessions; self-reported name of whoever actually clicked the button.
 * @param {string} [sourceTag] - optional casual label on the note (e.g. "Legal"),
 *   same URL-delivered-only scoping as decidedByName.
 * @return {{ok: boolean, message: string}}
 */
function api_clientSubmitDecision(token, postId, decision, comment, decidedByName, sourceTag) {
  var client = requireClient_(token);
  var decisionValue = decision === 'approve'
    ? CONFIG.APPROVAL_STATUSES.APPROVED
    : CONFIG.APPROVAL_STATUSES.CHANGES_REQUESTED;
  var result = processClientDecision_(client, postId, decisionValue,
    String(comment || '').trim(), String(decidedByName || '').trim(), String(sourceTag || '').trim());
  return { ok: result.ok, message: result.message };
}

/**
 * Removes agency-only fields from a post before sending to clients.
 * @param {Object} post
 * @return {Object}
 */
function stripInternalFields_(post) {
  var copy = {};
  for (var key in post) {
    if (!post.hasOwnProperty(key)) continue;
    if (key === 'Internal_Notes' || key === 'Created_By' || key === 'Modified_By') continue;
    copy[key] = post[key];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Notification queue processing
// ---------------------------------------------------------------------------

/**
 * Processes the Notification_Queue: sends due emails and marks them sent.
 * Installed as a 15-minute time-based trigger via setupNotificationTrigger().
 */
function processNotificationQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    console.error('processNotificationQueue: could not obtain lock; skipping run.');
    return;
  }
  try {
    var now = new Date();
    var unsent = dsGetUnsentNotifications();
    // Read Authorized_Clients once and build an email lookup, rather than
    // re-reading the whole sheet inside the per-row loop below. Previously
    // this ran once PER unsent notification while holding the global script
    // lock for the entire trigger run — with several rows queued, that held
    // up every other user's save/status-change action for the duration.
    // Fixed 2026-07-09 alongside the "too many simultaneous invocations" bug.
    var clientsByEmail_ = {};
    dsGetAuthorizedClients().forEach(function (ap) {
      clientsByEmail_[String(ap.Email).toLowerCase()] = ap;
    });
    unsent.forEach(function (row) {
      try {
        var sendAt = row.Send_At;
        var due = false;
        if (String(sendAt).toLowerCase() === 'now' || sendAt === '' || sendAt === null) {
          due = true;
        } else {
          var sendDate = (sendAt instanceof Date) ? sendAt : new Date(sendAt);
          due = !isNaN(sendDate.getTime()) && sendDate.getTime() <= now.getTime();
        }
        if (!due) return;

        var post = dsGetPostById(row.Post_ID);
        if (!post) {
          console.error('Notification ' + row.ID + ': post not found (' + row.Post_ID + '). Marking sent to avoid retries.');
          dsMarkNotificationSent(row.ID);
          return;
        }
        // Find the approver's token.
        var approver = clientsByEmail_[String(row.Approver_Email).toLowerCase()] || null;
        if (!approver) {
          console.error('Notification ' + row.ID + ': approver not found in Authorized_Clients (' +
            row.Approver_Email + '). Marking sent to avoid retries.');
          dsMarkNotificationSent(row.ID);
          return;
        }
        sendClientApprovalEmail(post, {
          Email: approver.Email,
          Name: row.Approver_Name || dsClientDisplayName(approver),
          Access_Token: approver.Access_Token
        });
        dsMarkApprovalEmailSent(row.Post_ID, row.Stage, approver.Email);
        dsMarkNotificationSent(row.ID);
      } catch (err) {
        console.error('processNotificationQueue row ' + row.ID + ' failed: ' + err.message);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Installs the 15-minute trigger for processNotificationQueue.
 * Run this ONCE manually from the Apps Script editor after deployment.
 */
function setupNotificationTrigger() {
  // Remove existing triggers for this function to avoid duplicates.
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processNotificationQueue') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('processNotificationQueue')
    .timeBased()
    .everyMinutes(15)
    .create();
  console.log('Trigger installed: processNotificationQueue every 15 minutes.');
}

// ---------------------------------------------------------------------------
// Simple server-rendered pages (sign-in prompts, confirmations, errors)
// ---------------------------------------------------------------------------

/**
 * Wraps body HTML in the standard minimal client-facing page shell.
 * @param {string} title
 * @param {string} bodyHtml
 * @return {string}
 */
function pageShell_(title, bodyHtml) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escapeHtml_(title) + '</title></head>' +
    '<body style="margin:0;background:#f4f5f7;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1a2e;">' +
    '<div style="background:#1a1a2e;padding:18px 24px;">' +
    '<span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:0.5px;">IES-TEXA</span>' +
    '<span style="color:#9aa0b4;font-size:12px;margin-left:12px;">Post Review</span>' +
    '</div>' +
    '<div style="max-width:560px;margin:40px auto;padding:0 20px;">' +
    '<div style="background:#fff;border:1px solid #e0e0e0;border-radius:12px;padding:32px;">' +
    bodyHtml +
    '</div>' +
    '<p style="text-align:center;color:#999;font-size:12px;margin-top:24px;">' +
    'Anthology FINN Partners &middot; IES-TEXA Social Post Approvals</p>' +
    '</div></body></html>';
}

/**
 * Renders a simple titled message page.
 * @param {string} title
 * @param {string} message - may contain basic HTML
 * @param {boolean} success - true for confirmation styling
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function renderMessagePage_(title, message, success) {
  var icon = success
    ? '<div style="font-size:48px;line-height:1;margin-bottom:16px;">&#9989;</div>'
    : '<div style="font-size:48px;line-height:1;margin-bottom:16px;">&#9888;&#65039;</div>';
  var html = pageShell_(title,
    icon +
    '<h1 style="font-size:22px;margin:0 0 12px 0;">' + title + '</h1>' +
    '<p style="font-size:16px;line-height:1.6;color:#555;margin:0;">' + message + '</p>');
  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ---------------------------------------------------------------------------
// Word (.docx) calendar export
// ---------------------------------------------------------------------------

/**
 * Builds a Word document (.docx) listing every post scheduled within a date
 * range — date, title, body copy, and media (embedded images, plus every
 * link so a video is still reachable even though it can't be embedded/played
 * in Word). No Status filtering: MJ's call (2026-07-09) is that this export
 * is a manual, agency-triggered action covered by the existing
 * human-review-before-external-send rule, not the automatic client-visible
 * gating added elsewhere this week — so it's on whoever runs the export to
 * remove anything not appropriate for the recipient before handing it off.
 * Status/Platform labels were printed per-post as a visual aid for that
 * review pass but were removed on 2026-07-09 (MJ's formatting pass) — the
 * safeguard is now purely procedural, not visible in the document itself.
 * @param {string} startDateStr - 'yyyy-MM-dd' (from an <input type="date">)
 * @param {string} endDateStr - 'yyyy-MM-dd'
 * @return {{filename: string, base64: string}}
 */
function api_exportCalendarToDocx(startDateStr, endDateStr) {
  requireAgencyUser_();

  var start = parseCalendarDate_(startDateStr);
  var end = parseCalendarDate_(endDateStr);
  if (!start || !end) throw new Error('Choose a valid start and end date.');
  if (start > end) throw new Error('Start date must be on or before the end date.');

  var posts = dsGetAllPosts()
    .filter(function (p) {
      var d = parseCalendarDate_(p.Scheduled_Date);
      return d && d >= start && d <= end;
    })
    .sort(function (a, b) {
      return parseCalendarDate_(a.Scheduled_Date) - parseCalendarDate_(b.Scheduled_Date);
    });

  var rangeLabel = formatCalendarDate_(start) + ' to ' + formatCalendarDate_(end);
  var doc = DocumentApp.create('IES-TEXA Calendar Export ' + rangeLabel + ' (temp)');
  var docId = doc.getId();

  try {
    buildCalendarDocBody_(doc, posts, rangeLabel);
    doc.saveAndClose();
    var docxBlob = exportGoogleDocAsDocx_(docId);
    return {
      filename: 'IES-TEXA Calendar ' + rangeLabel + '.docx',
      base64: Utilities.base64Encode(docxBlob.getBytes())
    };
  } finally {
    // Only the downloaded .docx is meant to persist — clean up the
    // intermediate Google Doc whether the export succeeded or failed.
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (cleanupErr) { /* best effort */ }
  }
}

/**
 * Fills in the body of the temp Google Doc used for the export.
 * @param {GoogleAppsScript.Document.Document} doc
 * @param {Array<Object>} posts - serialized post rows, already sorted
 * @param {string} rangeLabel
 */
function buildCalendarDocBody_(doc, posts, rangeLabel) {
  var body = doc.getBody();
  body.setMarginTop(40).setMarginBottom(40).setMarginLeft(56).setMarginRight(56);

  // Title lives in the repeating page header, not the body — matches MJ's
  // manually reformatted reference copy (IES-TEXA Calendar Aug 2026.docx).
  var header = doc.addHeader();
  var headerPar = header.appendParagraph('IES-TEXA Social Media Calendar');
  headerPar.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  var headerText = headerPar.editAsText();
  headerText.setFontSize(10);
  headerText.setBold(true);

  // Body starts directly with the first post — no title/date-range/disclaimer
  // paragraphs, to keep this from running long (MJ's call, 2026-07-09).
  if (!posts.length) {
    var emptyText = body.getParagraphs()[0].editAsText();
    emptyText.setFontSize(10);
    emptyText.setText('No posts are scheduled in this date range.');
    return;
  }

  posts.forEach(function (post, idx) {
    var dateHeading;
    if (idx === 0) {
      // Reuse the doc's default first paragraph so nothing precedes it.
      dateHeading = body.getParagraphs()[0];
    } else {
      body.appendHorizontalRule();
      dateHeading = body.appendParagraph('');
    }
    dateHeading.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    var dateText = dateHeading.editAsText();
    dateText.setFontSize(10);
    dateText.setText(formatCalendarDate_(parseCalendarDate_(post.Scheduled_Date)));

    var titleHeading = body.appendParagraph('');
    titleHeading.setHeading(DocumentApp.ParagraphHeading.HEADING3);
    var titleText = titleHeading.editAsText();
    titleText.setFontSize(10);
    titleText.setText(post.Title || '(untitled)');

    if (post.Post_Copy) {
      body.appendParagraph(post.Post_Copy).editAsText().setFontSize(10);
    } else {
      var noCopy = body.appendParagraph('(no post copy)').editAsText();
      noCopy.setFontSize(10);
      noCopy.setForegroundColor('#999999');
    }

    appendPostMediaToDoc_(body, post);
  });
}

/**
 * Appends every media asset attached to a post to the doc: embeds an image
 * where the URL classifies as one (sized to a fixed 2.25" tall, width scaled
 * to match, per MJ's page-count trim on 2026-07-09 — was 2.5"), and always
 * prints the bare link too (so a video, which can't be embedded/played in
 * Word, is still reachable — no instructional wording, just the link itself,
 * per MJ's edit). Field list mirrors buildAllMediaEmailHtml_ in
 * EmailService.gs, with the same Media_URL legacy fallback.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {Object} post
 */
function appendPostMediaToDoc_(body, post) {
  var fields = ['LinkedIn_URL', 'Facebook_URL', 'Instagram_URL', 'Carousel_URLs'];
  var seen = {};
  var any = false;

  fields.forEach(function (field) {
    var val = String(post[field] || '').trim();
    if (!val) return;
    var urls = val.split('\n')
      .map(function (u) { return u.trim(); })
      .filter(function (u) { return u && !seen[u]; });
    urls.forEach(function (u) {
      seen[u] = true;
      any = true;
      appendOneMediaAsset_(body, u);
    });
  });

  if (!any) {
    var legacy = String(post.Media_URL || '').trim();
    if (legacy) {
      any = true;
      appendOneMediaAsset_(body, legacy);
    }
  }

  if (!any) {
    var noMedia = body.appendParagraph('No media attached.').editAsText();
    noMedia.setFontSize(10);
    noMedia.setForegroundColor('#999999');
  }
}

/**
 * Reuses the existing classifyMediaUrl() (EmailService.gs) so Box/Drive/Canva
 * handling stays identical to what the notification emails already do.
 * @param {GoogleAppsScript.Document.Body} body
 * @param {string} url
 */
function appendOneMediaAsset_(body, url) {
  var media = classifyMediaUrl(url);
  if (media.type === 'image') {
    try {
      var resp = UrlFetchApp.fetch(media.thumbUrl || media.url, { muteHttpExceptions: true });
      if (resp.getResponseCode() === 200) {
        var img = body.appendImage(resp.getBlob());
        var originalHeight = img.getHeight();
        var originalWidth = img.getWidth();
        if (originalHeight > 0) {
          var targetHeightPt = 2.25 * 72; // MJ: 2.25" tall, width can scale freely
          var ratio = targetHeightPt / originalHeight;
          img.setHeight(Math.round(targetHeightPt));
          img.setWidth(Math.round(originalWidth * ratio));
        }
      }
    } catch (err) {
      // Fetch failed (e.g. sharing permissions) — the link line below still gets added.
    }
  }
  appendLinkLine_(body, url);
}

function appendLinkLine_(body, url) {
  var para = body.appendParagraph(url);
  var text = para.editAsText();
  text.setFontSize(10);
  text.setLinkUrl(0, url.length - 1, url);
}

/**
 * Parses a 'yyyy-MM-dd' (optionally with a time component) string, or a
 * Date, into a Date built from literal calendar components — avoids the
 * UTC-midnight timezone shift already documented in this project (session
 * log 2026-06-16: new Date('2026-06-01') lands a day early in Hawaiʻi).
 * @param {string|Date} value
 * @return {Date|null}
 */
function parseCalendarDate_(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  var s = String(value || '').trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function formatCalendarDate_(date) {
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return months[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
}

/**
 * Converts the just-created Google Doc into real .docx bytes via the Docs
 * export endpoint. Deliberately avoids the Advanced Drive Service (no extra
 * enablement step for MJ) — DocumentApp/DriveApp usage already causes GAS to
 * request an OAuth token with enough scope for this endpoint to accept it.
 * @param {string} fileId
 * @return {GoogleAppsScript.Base.Blob}
 */
function exportGoogleDocAsDocx_(fileId) {
  var url = 'https://docs.google.com/document/d/' + fileId + '/export?format=docx';
  var resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Could not convert the export to Word format (HTTP ' + resp.getResponseCode() + '). Try again, or check Drive permissions.');
  }
  return resp.getBlob().setName('export.docx');
}
