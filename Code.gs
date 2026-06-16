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

  var template = HtmlService.createTemplateFromFile('ClientPortal');
  template.token = token;
  template.accessLevel = client.Access_Level;
  template.approverName = dsClientDisplayName(client);
  template.approverEmail = client.Email;
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
 * @return {{ok: boolean, message: string, post: Object}}
 */
function processClientDecision_(client, postId, decision, notes) {
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
  dsRecordDecision(postId, stage, client.Email, approverName, decision, notes);

  // Save the optional comment as a client-visible comment.
  if (notes) {
    dsAddComment(postId, client.Email, approverName, notes, CONFIG.COMMENT_TYPES.CLIENT_REPLY);
  }

  // Advance or roll back status.
  if (decision === CONFIG.APPROVAL_STATUSES.APPROVED) {
    if (dsAllApprovedAtStage(postId, stage)) {
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
        }
      }
    }
  } else {
    // Changes requested: move post to Revising so it stays visible to clients
    // but is clearly in agency's court. Option B (confirmed by MJ 2026-06-11).
    dsUpdatePostStatus(postId, CONFIG.STATUSES.REVISING, client.Email);
  }

  var updatedPost = dsGetPostById(postId);

  // Notify the agency.
  try {
    sendAgencyActionEmail(updatedPost, approverName, decision, notes);
  } catch (err) {
    console.error('Agency notification failed: ' + err.message);
  }

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
      savedPost = dsUpdatePostStatus(postData.ID, postData.Status, user.Email);
      // For client review stages: create pending approvals + queue batch notification.
      var level = statusToAccessLevel(postData.Status);
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
      } else if (postData.Status === CONFIG.STATUSES.INTERNAL) {
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
  return { localCount: localCount, corpCount: corpCount, revisingByCorpCount: revisingByCorpCount };
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
 * Sends batch-queued notifications for a specific stage as a DIGEST —
 * one email per approver covering all their pending posts.
 * @param {string} stage - CONFIG.STAGES value (Local_Client or Corporate). If omitted, sends all.
 * @return {{sent: number, errors: number}}
 */
function api_sendBatch(stage) {
  requireAgencyUser_();
  var unsent = dsGetUnsentNotifications();
  var batch = unsent.filter(function (row) {
    if (String(row.Send_At).toLowerCase() !== 'batch') return false;
    if (stage) return String(row.Stage) === String(stage);
    return true;
  });

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

  // For a corporate send: advance any Awaiting_Corporate posts to Corporate_Review
  // so corporate approvers see the correct status in their portal.
  if (String(stage) === CONFIG.STAGES.CORPORATE) {
    var advancedIds = {};
    batch.forEach(function (row) {
      var pid = row.Post_ID;
      if (advancedIds[pid]) return;
      var post = dsGetPostById(pid);
      if (post && String(post.Status) === CONFIG.STATUSES.AWAITING_CORPORATE) {
        try {
          dsUpdatePostStatus(pid, CONFIG.STATUSES.CORPORATE, 'batch_send');
          advancedIds[pid] = true;
        } catch (err) {
          console.error('api_sendBatch: failed to advance ' + pid + ': ' + err.message);
        }
      }
    });
  }

  Object.keys(byApprover).forEach(function (key) {
    var data = byApprover[key];
    if (!data.posts.length) {
      // No posts resolved — just mark rows sent so queue stays clean.
      data.rows.forEach(function (r) { dsMarkNotificationSent(r.ID); });
      return;
    }
    var approver = data.approver;
    if (!approver) {
      data.rows.forEach(function (r) { dsMarkNotificationSent(r.ID); });
      return;
    }
    try {
      // Refresh post data so the email reflects the updated Corporate_Review status.
      var freshPosts = data.posts.map(function (p) {
        return dsGetPostById(p.ID) || p;
      });
      sendClientDigestEmail({
        Email: approver.Email,
        Name: data.name || dsClientDisplayName(approver),
        Access_Token: approver.Access_Token
      }, freshPosts);
      // Mark all rows for this approver as sent.
      data.rows.forEach(function (r) {
        dsMarkApprovalEmailSent(r.Post_ID, r.Stage, approver.Email);
        dsMarkNotificationSent(r.ID);
      });
      sent += data.rows.length;
    } catch (err) {
      console.error('api_sendBatch approver ' + key + ': ' + err.message);
      errors += data.rows.length;
    }
  });

  // When sending to corporate, also notify local approvers with a FYI digest.
  // Local has no action to take — this is a courtesy notification that the
  // batch is now in corporate review.
  if (sent > 0 && String(stage) === CONFIG.STAGES.CORPORATE) {
    try {
      var allSentPosts = [];
      var sentPids = {};
      Object.keys(byApprover).forEach(function (k) {
        (byApprover[k].posts || []).forEach(function (p) {
          if (!sentPids[p.ID]) { sentPids[p.ID] = true; allSentPosts.push(p); }
        });
      });
      if (allSentPosts.length) {
        var localFYIApprovers = dsGetAuthorizedClients(CONFIG.ACCESS_LEVELS.LOCAL).map(function (ap) {
          return { Email: ap.Email, Name: dsClientDisplayName(ap), Access_Token: ap.Access_Token };
        });
        sendLocalCorpBatchFYIEmail(localFYIApprovers, allSentPosts);
      }
    } catch (err) {
      console.error('api_sendBatch: local FYI failed: ' + err.message);
    }
  }

  return { sent: sent, errors: errors };
}

/**
 * Adds an agency comment to a post.
 * @param {string} postId
 * @param {string} text
 * @param {string} type - Internal or Client_Reply
 * @return {Object} the created comment
 */
function api_addComment(postId, text, type) {
  var user = requireAgencyUser_();
  var safeType = (type === CONFIG.COMMENT_TYPES.CLIENT_REPLY)
    ? CONFIG.COMMENT_TYPES.CLIENT_REPLY
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
  var visible = isCorp
    // Corporate sees: their review queue, Revising (so post doesn't disappear after they request changes),
    // plus final states.
    ? [CONFIG.STATUSES.REVISING, CONFIG.STATUSES.CORPORATE, CONFIG.STATUSES.APPROVED, CONFIG.STATUSES.PUBLISHED]
    // Local sees: their own queue, Awaiting_Corporate (so they can trigger the send),
    // Revising, and all downstream states.
    : [CONFIG.STATUSES.LOCAL_CLIENT, CONFIG.STATUSES.REVISING,
       CONFIG.STATUSES.AWAITING_CORPORATE, CONFIG.STATUSES.CORPORATE,
       CONFIG.STATUSES.APPROVED, CONFIG.STATUSES.PUBLISHED];
  var allowed = {};
  visible.forEach(function (s) { allowed[s] = true; });
  return dsGetAllPosts()
    .filter(function (p) { return !!allowed[p.Status]; })
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
 * Local portal: sends ALL Awaiting_Corporate posts to Corporate_Review in bulk.
 * Advances post statuses, fires digest emails to corporate approvers (same as
 * agency api_sendBatch), sends a FYI email to agency.
 * @param {string} token - local client token
 * @return {{ok: boolean, sent: number, errors: number}}
 */
function api_localSendToCorporate(token) {
  var client = requireClient_(token);
  if (client.Access_Level !== CONFIG.ACCESS_LEVELS.LOCAL) {
    throw new Error('Only local approvers can trigger this action.');
  }

  // Gather all Awaiting_Corporate posts that have unsent corporate notifications.
  var unsent = dsGetUnsentNotifications().filter(function (row) {
    return String(row.Send_At).toLowerCase() === 'batch' &&
           String(row.Stage) === CONFIG.STAGES.CORPORATE;
  });

  if (!unsent.length) {
    return { ok: true, sent: 0, errors: 0 };
  }

  // Advance posts and group notifications by corporate approver (same as sendBatch).
  var advancedIds = {};
  var byApprover = {};
  var allApprovers = dsGetAuthorizedClients();
  var approverLookup = {};
  allApprovers.forEach(function (ap) {
    approverLookup[String(ap.Email).toLowerCase()] = ap;
  });

  unsent.forEach(function (row) {
    var pid = row.Post_ID;
    if (!advancedIds[pid]) {
      var post = dsGetPostById(pid);
      if (post && String(post.Status) === CONFIG.STATUSES.AWAITING_CORPORATE) {
        try {
          dsUpdatePostStatus(pid, CONFIG.STATUSES.CORPORATE, client.Email);
          advancedIds[pid] = true;
        } catch (err) {
          console.error('api_localSendToCorporate: advance failed for ' + pid + ': ' + err.message);
        }
      }
    }
    var key = String(row.Approver_Email).toLowerCase();
    if (!byApprover[key]) {
      byApprover[key] = { rows: [], posts: [], approver: approverLookup[key] || null, name: row.Approver_Name };
    }
    byApprover[key].rows.push(row);
    var fresh = dsGetPostById(row.Post_ID);
    if (fresh) byApprover[key].posts.push(fresh);
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
      sendClientDigestEmail({
        Email: data.approver.Email,
        Name: data.name || dsClientDisplayName(data.approver),
        Access_Token: data.approver.Access_Token
      }, data.posts);
      data.rows.forEach(function (r) {
        dsMarkApprovalEmailSent(r.Post_ID, r.Stage, data.approver.Email);
        dsMarkNotificationSent(r.ID);
      });
      sent += data.rows.length;
    } catch (err) {
      console.error('api_localSendToCorporate approver ' + key + ': ' + err.message);
      errors += data.rows.length;
    }
  });

  // FYI to agency: local has sent posts to corporate.
  if (sent > 0) {
    try {
      var sentPosts = [];
      var seen = {};
      Object.keys(byApprover).forEach(function (k) {
        (byApprover[k].posts || []).forEach(function (p) {
          if (!seen[p.ID]) { seen[p.ID] = true; sentPosts.push(p); }
        });
      });
      sendAgencyCorpSentFYIEmail(sentPosts, dsClientDisplayName(client));
    } catch (err) {
      console.error('api_localSendToCorporate: agency FYI failed: ' + err.message);
    }
  }

  return { ok: true, sent: sent, errors: errors };
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
      notes: String(latest.Notes || '')
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
  if (!post) throw new Error('Post not found.');
  // Both local and corporate clients see the full non-internal discussion thread
  // (Client_Reply + Corporate_Reply). Internal comments stay hidden from all clients.
  var comments = dsGetCommentsForPost(postId).filter(function (c) {
    return c.Comment_Type === CONFIG.COMMENT_TYPES.CLIENT_REPLY ||
           c.Comment_Type === CONFIG.COMMENT_TYPES.CORPORATE_REPLY;
  });
  var canUndo = checkCanUndo_(client, post);
  return { post: stripInternalFields_(post), comments: comments, canUndo: canUndo };
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
 * @return {{ok: boolean}}
 */
function api_clientAddComment(token, postId, commentText) {
  var client = requireClient_(token);
  commentText = String(commentText || '').trim();
  if (!commentText) throw new Error('Comment cannot be empty.');
  var commentType = client.Access_Level === CONFIG.ACCESS_LEVELS.CORPORATE
    ? CONFIG.COMMENT_TYPES.CORPORATE_REPLY
    : CONFIG.COMMENT_TYPES.CLIENT_REPLY;
  dsAddComment(postId, client.Email, dsClientDisplayName(client), commentText, commentType);
  return { ok: true };
}

/**
 * Records a decision from the client portal.
 * @param {string} token
 * @param {string} postId
 * @param {string} decision - 'approve' or 'changes'
 * @param {string} comment
 * @return {{ok: boolean, message: string}}
 */
function api_clientSubmitDecision(token, postId, decision, comment) {
  var client = requireClient_(token);
  var decisionValue = decision === 'approve'
    ? CONFIG.APPROVAL_STATUSES.APPROVED
    : CONFIG.APPROVAL_STATUSES.CHANGES_REQUESTED;
  var result = processClientDecision_(client, postId, decisionValue,
    String(comment || '').trim());
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
        var approver = null;
        dsGetAuthorizedClients().forEach(function (ap) {
          if (String(ap.Email).toLowerCase() === String(row.Approver_Email).toLowerCase()) {
            approver = ap;
          }
        });
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
