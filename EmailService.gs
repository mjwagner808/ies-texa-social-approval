/**
 * EmailService.gs
 * Anthology FINN Partners — IES-TEXA Social Post Approval Tool
 * Email composition and sending via SendGrid (falls back to MailApp).
 *
 * Required Script Properties (Project Settings → Script Properties):
 *   SENDGRID_API_KEY  — SendGrid API key (starts with SG.)
 */

// ---------------------------------------------------------------------------
// Email transport layer
// ---------------------------------------------------------------------------

/**
 * Sends an email via SendGrid if the API key is set in Script Properties,
 * otherwise falls back to MailApp. Drop-in replacement for MailApp.sendEmail().
 * @param {{to:string, subject:string, body:string, htmlBody:string, name:string}} options
 * @return {boolean} true if sent successfully
 */
function sendEmail_(options) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('SENDGRID_API_KEY');
  if (apiKey) {
    return sendViaSendGrid_(options, apiKey);
  }
  // Fallback: MailApp (may be blocked by Proofpoint for @finnpartners.com recipients)
  try {
    MailApp.sendEmail(options);
    return true;
  } catch (e) {
    console.error('MailApp fallback failed: ' + e.message);
    return false;
  }
}

/**
 * Sends an email via SendGrid Web API v3.
 * FROM address: CONFIG.SENDGRID_FROM_EMAIL (anthologysocial@finnpartners.com)
 * @param {Object} options - same shape as MailApp.sendEmail options
 * @param {string} apiKey - SendGrid API key
 * @return {boolean} true if SendGrid accepted (HTTP 202)
 */
function sendViaSendGrid_(options, apiKey) {
  var fromEmail = CONFIG.SENDGRID_FROM_EMAIL;
  var fromName  = options.name || 'Anthology FINN Partners';
  // Support comma-separated recipient lists
  var toAddresses = String(options.to || '').split(',')
    .map(function (e) { return e.trim(); })
    .filter(Boolean)
    .map(function (e) { return { email: e }; });

  var payload = {
    personalizations: [{ to: toAddresses }],
    from: { email: fromEmail, name: fromName },
    subject: options.subject || '',
    content: [
      { type: 'text/plain', value: options.body     || '' },
      { type: 'text/html',  value: options.htmlBody || options.body || '' }
    ]
  };

  try {
    var response = UrlFetchApp.fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'post',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    var code = response.getResponseCode();
    console.log('SendGrid ' + code + ' → ' + options.to + ' | ' + options.subject);
    if (code !== 202) {
      console.error('SendGrid non-202: ' + response.getContentText());
    }
    return code === 202;
  } catch (e) {
    console.error('SendGrid fetch error: ' + e.message);
    // Last-resort MailApp fallback
    try { MailApp.sendEmail(options); } catch (e2) {}
    return false;
  }
}

/**
 * Test function — run once in the GAS editor to confirm SendGrid is working.
 * Check mj.wagner@finnpartners.com for the test message after running.
 */
function testSendGrid() {
  var result = sendEmail_({
    to: 'mj.wagner@finnpartners.com',
    subject: '[TEST] IES-TEXA SendGrid integration',
    body: 'SendGrid is configured correctly.',
    htmlBody: '<p style="font-family:Arial;font-size:15px;">SendGrid is configured correctly for the IES-TEXA approval tool.</p>',
    name: 'Anthology FINN Partners'
  });
  console.log('testSendGrid result: ' + (result ? 'sent via SendGrid' : 'failed or fell back'));
}

// ---------------------------------------------------------------------------
// Media URL classification
// ---------------------------------------------------------------------------

/**
 * Classifies a media URL for rendering purposes.
 * @param {string} url
 * @return {{type: string, url: string}} type: 'none' | 'image' | 'box' | 'canva' | 'link'
 */
function classifyMediaUrl(url) {
  var u = String(url || '').trim();
  if (!u) return { type: 'none', url: '' };
  var lower = u.toLowerCase();
  if (lower.indexOf('box.com') !== -1) return { type: 'box', url: u };
  if (lower.indexOf('canva.com') !== -1) return { type: 'canva', url: u };
  if (/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/.test(lower) ||
      lower.indexOf('s3.amazonaws.com') !== -1) {
    return { type: 'image', url: u };
  }
  return { type: 'link', url: u };
}

/**
 * Builds the HTML snippet for a post's media inside an email body.
 * @param {string} mediaUrl
 * @return {string} HTML
 */
function buildMediaEmailHtml_(mediaUrl) {
  var media = classifyMediaUrl(mediaUrl);
  switch (media.type) {
    case 'image':
      return '<div style="margin:16px 0;">' +
        '<img src="' + escapeHtmlAttr_(media.url) + '" alt="Post image" ' +
        'style="max-width:100%;border-radius:8px;border:1px solid #e0e0e0;" />' +
        '</div>';
    case 'box':
      return '<div style="margin:16px 0;">' +
        '<a href="' + escapeHtmlAttr_(media.url) + '" ' +
        'style="color:#1a73e8;font-weight:600;">View media (Box link)</a>' +
        '</div>';
    case 'canva':
      return '<div style="margin:16px 0;">' +
        '<a href="' + escapeHtmlAttr_(media.url) + '" ' +
        'style="color:#1a73e8;font-weight:600;">View in Canva</a>' +
        '</div>';
    case 'link':
      return '<div style="margin:16px 0;">' +
        '<a href="' + escapeHtmlAttr_(media.url) + '" ' +
        'style="color:#1a73e8;font-weight:600;">View media</a>' +
        '</div>';
    default:
      return '';
  }
}

/**
 * Builds the HTML snippet for all of a post's per-platform media assets
 * inside an email body. Falls back to the legacy Media_URL field if no
 * platform-specific fields are populated.
 * @param {Object} post - serialized post row
 * @return {string} HTML
 */
function buildAllMediaEmailHtml_(post) {
  var sections = [
    { label: 'LinkedIn', field: 'LinkedIn_URL' },
    { label: 'Facebook', field: 'Facebook_URL' },
    { label: 'Instagram', field: 'Instagram_URL' },
    { label: 'Carousel / All platforms', field: 'Carousel_URLs' }
  ];
  var html = '';
  sections.forEach(function (s) {
    var val = String(post[s.field] || '').trim();
    if (!val) return;
    var urls = val.split('\n').map(function (u) { return u.trim(); }).filter(function (u) { return u; });
    if (!urls.length) return;
    html += '<div style="margin:12px 0 4px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#555;">' + escapeHtml_(s.label) + '</div>';
    urls.forEach(function (url, idx) {
      var media = classifyMediaUrl(url);
      var num = (idx + 1) + '. ';
      if (media.type === 'image') {
        html += '<div style="margin:6px 0;">' + num + '<img src="' + escapeHtmlAttr_(url) + '" alt="Image ' + (idx + 1) + '" style="max-width:100%;max-height:280px;border-radius:6px;border:1px solid #e0e0e0;" /></div>';
      } else if (media.type === 'box') {
        html += '<div style="margin:6px 0;">' + num + '<a href="' + escapeHtmlAttr_(url) + '" style="color:#1a73e8;font-weight:600;">View media (Box link)</a></div>';
      } else if (media.type === 'canva') {
        html += '<div style="margin:6px 0;">' + num + '<a href="' + escapeHtmlAttr_(url) + '" style="color:#1a73e8;font-weight:600;">View in Canva</a></div>';
      } else if (media.type === 'link') {
        html += '<div style="margin:6px 0;">' + num + '<a href="' + escapeHtmlAttr_(url) + '" style="color:#1a73e8;font-weight:600;">View media</a></div>';
      }
    });
  });
  // Fallback to legacy Media_URL
  if (!html) {
    html = buildMediaEmailHtml_(post.Media_URL || '');
  }
  return html ? '<div style="margin:16px 0;">' + html + '</div>' : '';
}

// ---------------------------------------------------------------------------
// HTML escaping helpers
// ---------------------------------------------------------------------------

/**
 * Escapes a string for use in HTML body text.
 * @param {string} s
 * @return {string}
 */
function escapeHtml_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes a string for use in an HTML attribute.
 * @param {string} s
 * @return {string}
 */
function escapeHtmlAttr_(s) {
  return escapeHtml_(s);
}

/**
 * Converts plain text to HTML with line breaks preserved.
 * @param {string} s
 * @return {string}
 */
function textToHtml_(s) {
  return escapeHtml_(s).replace(/\r\n|\r|\n/g, '<br/>');
}

// ---------------------------------------------------------------------------
// Email 1: Client approval needed
// ---------------------------------------------------------------------------

/**
 * Sends the "Your approval is needed" email to a client approver.
 * @param {Object} post - serialized post row
 * @param {Object} approver - {Email, Name, Access_Token}
 */
function sendClientApprovalEmail(post, approver) {
  var token = approver.Access_Token;
  var approveUrl = CONFIG.APP_URL +
    '?page=client&token=' + encodeURIComponent(token) +
    '&action=approve&post=' + encodeURIComponent(post.ID);
  // Note: changesUrl now goes directly to the portal (not a form POST action URL).
  // This avoids the "refused to connect" error caused by GAS's post-submit redirect.
  // The portal has native Approve/Request Changes buttons that use google.script.run.
  var changesUrl = CONFIG.APP_URL +
    '?page=client&token=' + encodeURIComponent(token);
  var portalUrl = CONFIG.APP_URL + '?page=client&token=' + encodeURIComponent(token);

  var scheduled = post.Scheduled_Date ? formatDateValue(post.Scheduled_Date, 'EEEE, MMMM d, yyyy') : 'Not scheduled yet';
  var platforms = String(post.Platform || '').split(',').map(function (p) { return p.trim(); })
    .filter(function (p) { return p; }).join(', ') || 'Not specified';

  var htmlBody = '' +
    '<div style="margin:0;padding:0;background:#f4f5f7;">' +
    '<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">' +

    '<div style="background:#ffffff;border-radius:12px;border:1px solid #e0e0e0;overflow:hidden;">' +

    '<div style="background:#1a1a2e;padding:20px 28px;">' +
    '<div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">IES-TEXA</div>' +
    '<div style="color:#9aa0b4;font-size:12px;margin-top:4px;">Social Media Post Approval</div>' +
    '</div>' +

    '<div style="padding:28px;">' +
    '<h1 style="font-size:20px;margin:0 0 8px 0;color:#1a1a2e;">Your approval is needed</h1>' +
    '<p style="font-size:15px;line-height:1.6;margin:0 0 20px 0;color:#444;">' +
    'Hello ' + escapeHtml_(approver.Name) + ', a social media post is ready for your review.</p>' +

    '<table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">' +
    '<tr><td style="padding:6px 0;color:#888;width:130px;">Post title</td>' +
    '<td style="padding:6px 0;font-weight:600;">' + escapeHtml_(post.Title) + '</td></tr>' +
    '<tr><td style="padding:6px 0;color:#888;">Scheduled for</td>' +
    '<td style="padding:6px 0;">' + escapeHtml_(scheduled) + '</td></tr>' +
    '<tr><td style="padding:6px 0;color:#888;">Platform(s)</td>' +
    '<td style="padding:6px 0;">' + escapeHtml_(platforms) + '</td></tr>' +
    '</table>' +

    '<div style="background:#f8f9fb;border:1px solid #e8eaef;border-radius:8px;padding:18px;font-size:15px;line-height:1.7;color:#333;">' +
    textToHtml_(post.Post_Copy) +
    '</div>' +

    buildAllMediaEmailHtml_(post) +

    '<div style="text-align:center;margin:28px 0 8px 0;">' +
    '<a href="' + escapeHtmlAttr_(approveUrl) + '" ' +
    'style="display:inline-block;background:#4CAF50;color:#ffffff;text-decoration:none;' +
    'font-size:17px;font-weight:700;padding:16px 36px;border-radius:8px;margin:6px;">' +
    '&#9989; Approve</a>' +
    '<a href="' + escapeHtmlAttr_(changesUrl) + '" ' +
    'style="display:inline-block;background:#FF9800;color:#ffffff;text-decoration:none;' +
    'font-size:17px;font-weight:700;padding:16px 36px;border-radius:8px;margin:6px;">' +
    '&#128260; Request Changes</a>' +
    '</div>' +

    '</div>' +

    '<div style="background:#f8f9fb;border-top:1px solid #e8eaef;padding:16px 28px;font-size:12px;color:#888;">' +
    'Or visit your review portal: <a href="' + escapeHtmlAttr_(portalUrl) + '" style="color:#1a73e8;">' +
    escapeHtml_(portalUrl) + '</a><br/><br/>' +
    'Sent by Anthology FINN Partners on behalf of IES-TEXA.' +
    '</div>' +

    '</div></div></div>';

  var plainBody = 'Your approval is needed: ' + post.Title + '\n\n' +
    'Scheduled for: ' + scheduled + '\n' +
    'Platform(s): ' + platforms + '\n\n' +
    post.Post_Copy + '\n\n' +
    'Approve: ' + approveUrl + '\n' +
    'Request changes (visit portal): ' + changesUrl + '\n\n' +
    'Or visit your review portal: ' + portalUrl;

  sendEmail_({
    to: approver.Email,
    subject: '[IES-TEXA] Your approval is needed: ' + post.Title,
    body: plainBody,
    htmlBody: htmlBody,
    name: 'Anthology FINN Partners'
  });
}

// ---------------------------------------------------------------------------
// Email 2: Digest — client review request (one email per approver, all posts)
// ---------------------------------------------------------------------------

/**
 * Sends a single digest email to a client approver listing all posts ready
 * for their review. Replaces per-post sendClientApprovalEmail in batch sends.
 * @param {Object} approver - {Email, Name, Access_Token}
 * @param {Array<Object>} posts - array of post rows awaiting this approver
 */
function sendClientDigestEmail(approver, posts) {
  if (!posts || !posts.length) return;
  var token = approver.Access_Token;
  var portalUrl = CONFIG.APP_URL + '?page=client&token=' + encodeURIComponent(token);
  var count = posts.length;
  var subject = '[IES-TEXA] ' + count + ' post' + (count > 1 ? 's' : '') +
    ' ready for your review';

  var postsHtml = '';
  posts.forEach(function (post, idx) {
    var scheduled = post.Scheduled_Date
      ? formatDateValue(post.Scheduled_Date, 'EEEE, MMMM d, yyyy')
      : 'Not scheduled yet';
    var platforms = String(post.Platform || '').split(',')
      .map(function (p) { return p.trim(); }).filter(function (p) { return p; }).join(', ') || 'Not specified';
    var excerpt = String(post.Post_Copy || '');
    if (excerpt.length > 180) excerpt = excerpt.slice(0, 180) + '...';

    postsHtml +=
      '<div style="border:1px solid #e0e0e0;border-radius:8px;padding:18px;' +
      'margin-bottom:16px;background:#fff;">' +
      '<div style="font-size:16px;font-weight:700;color:#1a1a2e;margin-bottom:8px;">' +
      (idx + 1) + '. ' + escapeHtml_(post.Title || '(untitled)') + '</div>' +
      '<table style="font-size:13px;color:#666;margin-bottom:10px;">' +
      '<tr><td style="padding:2px 12px 2px 0;">Scheduled</td>' +
      '<td style="padding:2px 0;color:#333;">' + escapeHtml_(scheduled) + '</td></tr>' +
      '<tr><td style="padding:2px 12px 2px 0;">Platform(s)</td>' +
      '<td style="padding:2px 0;color:#333;">' + escapeHtml_(platforms) + '</td></tr>' +
      '</table>' +
      '<div style="background:#f8f9fb;border-radius:6px;padding:12px;font-size:14px;' +
      'line-height:1.6;color:#444;">' + textToHtml_(excerpt) + '</div>' +
      '</div>';
  });

  var htmlBody =
    '<div style="margin:0;padding:0;background:#f4f5f7;">' +
    '<div style="max-width:600px;margin:0 auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">' +
    '<div style="background:#ffffff;border-radius:12px;border:1px solid #e0e0e0;overflow:hidden;">' +
    '<div style="background:#1a1a2e;padding:20px 28px;">' +
    '<div style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.5px;">IES-TEXA</div>' +
    '<div style="color:#9aa0b4;font-size:12px;margin-top:4px;">Social Media Post Approval</div>' +
    '</div>' +
    '<div style="padding:28px;">' +
    '<h1 style="font-size:20px;margin:0 0 8px 0;color:#1a1a2e;">Your approval is needed</h1>' +
    '<p style="font-size:15px;line-height:1.6;margin:0 0 24px 0;color:#444;">' +
    'Hello ' + escapeHtml_(approver.Name) + ', you have ' + count +
    ' post' + (count > 1 ? 's' : '') + ' waiting for your review.</p>' +
    postsHtml +
    '<div style="text-align:center;margin:28px 0 8px 0;">' +
    '<a href="' + escapeHtmlAttr_(portalUrl) + '" ' +
    'style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;' +
    'font-size:17px;font-weight:700;padding:16px 40px;border-radius:8px;">' +
    'Review all posts &rarr;</a>' +
    '</div>' +
    '</div>' +
    '<div style="background:#f8f9fb;border-top:1px solid #e8eaef;padding:16px 28px;font-size:12px;color:#888;">' +
    'Visit your review portal: <a href="' + escapeHtmlAttr_(portalUrl) + '" style="color:#1a73e8;">' +
    escapeHtml_(portalUrl) + '</a><br/><br/>' +
    'Sent by Anthology FINN Partners on behalf of IES-TEXA.' +
    '</div>' +
    '</div></div></div>';

  var plainBody = 'You have ' + count + ' post' + (count > 1 ? 's' : '') +
    ' ready for your review:\n\n';
  posts.forEach(function (post, idx) {
    plainBody += (idx + 1) + '. ' + (post.Title || '(untitled)') + '\n';
    if (post.Scheduled_Date) plainBody += '   Scheduled: ' + post.Scheduled_Date + '\n';
  });
  plainBody += '\nGo to your review portal: ' + portalUrl;

  sendEmail_({
    to: approver.Email,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    name: 'Anthology FINN Partners'
  });
}

// ---------------------------------------------------------------------------
// Email 3: Agency notification — client took action
// ---------------------------------------------------------------------------

/**
 * Notifies the agency that a client approver took action on a post.
 * @param {Object} post - serialized post row
 * @param {string} approverName
 * @param {string} decision - Approved or Changes_Requested
 * @param {string} notes - optional decision notes / comment
 */
function sendAgencyActionEmail(post, approverName, decision, notes) {
  var isApproved = decision === CONFIG.APPROVAL_STATUSES.APPROVED;
  var isUndo = decision === 'undo';
  var actionPhrase = isUndo ? 'reversed their decision on'
    : isApproved ? 'approved'
    : 'requested changes on';
  var actionColor = isUndo ? '#607D8B' : isApproved ? '#4CAF50' : '#FF9800';
  // Note: no emoji in subject — emoji in subjects triggers Microsoft 365 spam filters.
  var subject = '[IES-TEXA] ' + approverName + ' ' + actionPhrase + ' "' + post.Title + '"';
  var agencyLink = CONFIG.APP_URL + '?post=' + encodeURIComponent(post.ID);
  var scheduled = post.Scheduled_Date
    ? formatDateValue(post.Scheduled_Date, 'EEEE, MMMM d, yyyy')
    : 'Not scheduled';

  var notesHtml = notes
    ? '<div style="background:#fff8e1;border-left:4px solid #FF9800;padding:14px 18px;' +
      'margin:20px 0;border-radius:0 8px 8px 0;font-size:15px;color:#555;">' +
      '<strong>Their comment:</strong><br/>' + textToHtml_(notes) + '</div>'
    : '';

  var htmlBody =
    '<div style="margin:0;padding:0;background:#f4f5f7;">' +
    '<div style="max-width:600px;margin:0 auto;padding:24px;' +
    'font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">' +
    '<div style="background:#ffffff;border-radius:12px;border:1px solid #e0e0e0;overflow:hidden;">' +

    '<div style="background:#1a1a2e;padding:20px 28px;">' +
    '<div style="color:#ffffff;font-size:18px;font-weight:700;">IES-TEXA</div>' +
    '<div style="color:#9aa0b4;font-size:12px;margin-top:4px;">Agency Notification</div>' +
    '</div>' +

    '<div style="padding:28px;">' +
    '<div style="background:' + actionColor + ';color:#fff;border-radius:8px;' +
    'padding:14px 20px;font-size:17px;font-weight:700;margin-bottom:20px;">' +
    escapeHtml_(approverName) + ' ' + actionPhrase +
    ' &ldquo;' + escapeHtml_(post.Title) + '&rdquo;</div>' +

    '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
    '<tr><td style="padding:6px 0;color:#888;width:130px;">Post</td>' +
    '<td style="padding:6px 0;font-weight:600;">' + escapeHtml_(post.Title) + '</td></tr>' +
    '<tr><td style="padding:6px 0;color:#888;">Scheduled</td>' +
    '<td style="padding:6px 0;">' + escapeHtml_(scheduled) + '</td></tr>' +
    '<tr><td style="padding:6px 0;color:#888;">New status</td>' +
    '<td style="padding:6px 0;">' + escapeHtml_(post.Status || '') + '</td></tr>' +
    '</table>' +

    notesHtml +

    '<div style="text-align:center;margin:24px 0 8px 0;">' +
    '<a href="' + escapeHtmlAttr_(agencyLink) + '" ' +
    'style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;' +
    'font-size:16px;font-weight:700;padding:14px 32px;border-radius:8px;">' +
    'View in agency dashboard &rarr;</a>' +
    '</div>' +
    '</div>' +

    '<div style="background:#f8f9fb;border-top:1px solid #e8eaef;padding:14px 28px;' +
    'font-size:12px;color:#888;">' +
    'Sent by Anthology FINN Partners &bull; IES-TEXA Social Media Approval Tool' +
    '</div>' +
    '</div></div></div>';

  var plainBody = approverName + ' ' + actionPhrase + ' "' + post.Title + '".\n\n' +
    'Status: ' + (post.Status || '') + '\n' +
    'Scheduled: ' + scheduled + '\n';
  if (notes) { plainBody += '\nComment:\n' + notes + '\n'; }
  plainBody += '\nView post: ' + agencyLink;

  var recipients = dsGetAgencyNotificationEmails();
  console.log('sendAgencyActionEmail: recipients=[' + recipients.join(', ') + '] post=' + post.ID + ' decision=' + decision);
  if (!recipients.length) {
    console.error('sendAgencyActionEmail: no recipients found — check AGENCY_NOTIFICATION_EMAILS in Config.gs and Users sheet.');
    return;
  }
  recipients.forEach(function (email) {
    try {
      sendEmail_({
        to: email,
        subject: subject,
        body: plainBody,
        htmlBody: htmlBody,
        name: 'Anthology FINN Partners'
      });
      console.log('sendAgencyActionEmail: sent to ' + email);
    } catch (err) {
      console.error('sendAgencyActionEmail to ' + email + ' failed: ' + err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Email 3b: Local client FYI — sent when agency re-sends to corporate review
// ---------------------------------------------------------------------------

/**
 * Notifies local client approvers that a post has been sent back to corporate
 * review by the agency (after corporate requested changes). Informational only —
 * no action is required from local.
 * @param {Object} post - serialized post row
 * @param {Array<Object>} localApprovers - [{Email, Name}]
 */
function sendLocalCorpReSendFYIEmail(post, localApprovers) {
  if (!localApprovers || !localApprovers.length) return;
  var scheduled = post.Scheduled_Date
    ? formatDateValue(post.Scheduled_Date, 'EEEE, MMMM d, yyyy')
    : 'Not scheduled';
  var subject = '[IES-TEXA] Update on "' + post.Title + '" — back in corporate review';

  var htmlBody =
    '<div style="margin:0;padding:0;background:#f4f5f7;">' +
    '<div style="max-width:600px;margin:0 auto;padding:24px;' +
    'font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">' +
    '<div style="background:#ffffff;border-radius:12px;border:1px solid #e0e0e0;overflow:hidden;">' +

    '<div style="background:#1a1a2e;padding:20px 28px;">' +
    '<div style="color:#ffffff;font-size:18px;font-weight:700;">IES-TEXA</div>' +
    '<div style="color:#9aa0b4;font-size:12px;margin-top:4px;">Post Update</div>' +
    '</div>' +

    '<div style="padding:28px;">' +
    '<div style="background:#3D1070;color:#fff;border-radius:8px;' +
    'padding:14px 20px;font-size:17px;font-weight:700;margin-bottom:20px;">' +
    'Update on &ldquo;' + escapeHtml_(post.Title) + '&rdquo;</div>' +

    '<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 20px 0;">' +
    'This post has been sent back to the corporate review team for a second look. ' +
    'No action is needed from you at this time. ' +
    'The Anthology FINN Partners team will keep you updated on the outcome.</p>' +

    '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
    '<tr><td style="padding:6px 0;color:#888;width:130px;">Post</td>' +
    '<td style="padding:6px 0;font-weight:600;">' + escapeHtml_(post.Title) + '</td></tr>' +
    '<tr><td style="padding:6px 0;color:#888;">Scheduled</td>' +
    '<td style="padding:6px 0;">' + escapeHtml_(scheduled) + '</td></tr>' +
    '</table>' +
    '</div>' +

    '<div style="background:#f8f9fb;border-top:1px solid #e8eaef;padding:14px 28px;' +
    'font-size:12px;color:#888;">' +
    'Sent by Anthology FINN Partners &bull; IES-TEXA Social Media Approval Tool' +
    '</div>' +
    '</div></div></div>';

  var plainBody = 'Update on "' + post.Title + '"\n\n' +
    'This post has been sent back to the corporate review team for a second look. ' +
    'No action is needed from you at this time. ' +
    'The Anthology FINN Partners team will keep you updated on the outcome.\n\n' +
    'Post: ' + post.Title + '\nScheduled: ' + scheduled + '\n\nAnthology FINN Partners';

  localApprovers.forEach(function (ap) {
    try {
      sendEmail_({
        to: ap.Email,
        subject: subject,
        body: plainBody,
        htmlBody: htmlBody,
        name: 'Anthology FINN Partners'
      });
    } catch (err) {
      console.error('sendLocalCorpReSendFYIEmail to ' + ap.Email + ' failed: ' + err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Email 3c: Local client update — sent when corporate approver acts
// ---------------------------------------------------------------------------

/**
 * Notifies local client approvers of corporate's decision on a post.
 * @param {Object} post - serialized post row
 * @param {Array<Object>} localApprovers - [{Email, Name, Access_Token}]
 * @param {string} corporateApproverName
 * @param {string} decision - Approved or Changes_Requested
 */
function sendLocalClientUpdateEmail(post, localApprovers, corporateApproverName, decision) {
  if (!localApprovers || !localApprovers.length) return;
  var isApproved = decision === CONFIG.APPROVAL_STATUSES.APPROVED;
  var actionColor = isApproved ? '#4CAF50' : '#FF9800';
  var subject = isApproved
    ? '[IES-TEXA] "' + post.Title + '" has been approved'
    : '[IES-TEXA] Changes have been requested for "' + post.Title + '"';
  var bodyLine = isApproved
    ? corporateApproverName + ' has approved this post. The Anthology FINN Partners team will schedule it for publication.'
    : corporateApproverName + ' has requested changes to this post. The team will be in touch with revisions.';
  var scheduled = post.Scheduled_Date
    ? formatDateValue(post.Scheduled_Date, 'EEEE, MMMM d, yyyy')
    : 'Not scheduled';

  localApprovers.forEach(function (ap) {
    var portalUrl = CONFIG.APP_URL + '?page=client&token=' + encodeURIComponent(ap.Access_Token || '');

    var htmlBody =
      '<div style="margin:0;padding:0;background:#f4f5f7;">' +
      '<div style="max-width:600px;margin:0 auto;padding:24px;' +
      'font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">' +
      '<div style="background:#ffffff;border-radius:12px;border:1px solid #e0e0e0;overflow:hidden;">' +

      '<div style="background:#1a1a2e;padding:20px 28px;">' +
      '<div style="color:#ffffff;font-size:18px;font-weight:700;">IES-TEXA</div>' +
      '<div style="color:#9aa0b4;font-size:12px;margin-top:4px;">Post Update</div>' +
      '</div>' +

      '<div style="padding:28px;">' +
      '<div style="background:' + actionColor + ';color:#fff;border-radius:8px;' +
      'padding:14px 20px;font-size:17px;font-weight:700;margin-bottom:20px;">' +
      'Update on &ldquo;' + escapeHtml_(post.Title) + '&rdquo;</div>' +

      '<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 20px 0;">' +
      escapeHtml_(bodyLine) + '</p>' +

      '<table style="width:100%;border-collapse:collapse;font-size:14px;">' +
      '<tr><td style="padding:6px 0;color:#888;width:130px;">Post</td>' +
      '<td style="padding:6px 0;font-weight:600;">' + escapeHtml_(post.Title) + '</td></tr>' +
      '<tr><td style="padding:6px 0;color:#888;">Scheduled</td>' +
      '<td style="padding:6px 0;">' + escapeHtml_(scheduled) + '</td></tr>' +
      '</table>' +

      '<div style="text-align:center;margin:24px 0 8px 0;">' +
      '<a href="' + escapeHtmlAttr_(portalUrl) + '" ' +
      'style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;' +
      'font-size:15px;font-weight:700;padding:12px 28px;border-radius:8px;">' +
      'View your full calendar &rarr;</a>' +
      '</div>' +
      '</div>' +

      '<div style="background:#f8f9fb;border-top:1px solid #e8eaef;padding:14px 28px;' +
      'font-size:12px;color:#888;">' +
      'Sent by Anthology FINN Partners &bull; IES-TEXA Social Media Approval Tool' +
      '</div>' +
      '</div></div></div>';

    var plainBody = subject + '\n\n' + bodyLine + '\n\nPost: ' + post.Title +
      '\nScheduled: ' + scheduled + '\n\nView your review portal: ' + portalUrl +
      '\n\nAnthology FINN Partners';

    try {
      sendEmail_({
        to: ap.Email,
        subject: subject,
        body: plainBody,
        htmlBody: htmlBody,
        name: 'Anthology FINN Partners'
      });
    } catch (err) {
      console.error('sendLocalClientUpdateEmail to ' + ap.Email + ' failed: ' + err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Email 4: Local client FYI digest — sent when agency sends batch to corporate
// ---------------------------------------------------------------------------

/**
 * Notifies local client approvers that the agency has sent a batch of posts
 * to corporate review. Informational only — no action is required from local.
 * @param {Array<Object>} localApprovers - [{Email, Name, Access_Token}]
 * @param {Array<Object>} posts - posts that were sent to corporate
 */
function sendLocalCorpBatchFYIEmail(localApprovers, posts) {
  if (!localApprovers || !localApprovers.length || !posts || !posts.length) return;
  var count = posts.length;
  var subject = '[IES-TEXA] ' + count + ' post' + (count !== 1 ? 's' : '') +
    ' sent to corporate review';

  var postsHtml = '';
  posts.forEach(function (post, idx) {
    var scheduled = post.Scheduled_Date
      ? formatDateValue(post.Scheduled_Date, 'EEEE, MMMM d, yyyy')
      : 'Not scheduled';
    postsHtml +=
      '<div style="border:1px solid #e0e0e0;border-radius:6px;padding:14px;' +
      'margin-bottom:10px;background:#fff;">' +
      '<div style="font-size:15px;font-weight:700;color:#1a1a2e;margin-bottom:4px;">' +
      (idx + 1) + '. ' + escapeHtml_(post.Title || '(untitled)') + '</div>' +
      '<div style="font-size:13px;color:#666;">Scheduled: ' + escapeHtml_(scheduled) + '</div>' +
      '</div>';
  });

  localApprovers.forEach(function (ap) {
    var portalUrl = CONFIG.APP_URL + '?page=client&token=' + encodeURIComponent(ap.Access_Token || '');

    var htmlBody =
      '<div style="margin:0;padding:0;background:#f4f5f7;">' +
      '<div style="max-width:600px;margin:0 auto;padding:24px;' +
      'font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">' +
      '<div style="background:#ffffff;border-radius:12px;border:1px solid #e0e0e0;overflow:hidden;">' +

      '<div style="background:#1a1a2e;padding:20px 28px;">' +
      '<div style="color:#ffffff;font-size:18px;font-weight:700;">IES-TEXA</div>' +
      '<div style="color:#9aa0b4;font-size:12px;margin-top:4px;">Post Update</div>' +
      '</div>' +

      '<div style="padding:28px;">' +
      '<div style="background:#3D1070;color:#fff;border-radius:8px;' +
      'padding:14px 20px;font-size:17px;font-weight:700;margin-bottom:20px;">' +
      count + ' post' + (count !== 1 ? 's' : '') + ' sent to corporate review</div>' +

      '<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 20px 0;">' +
      'The following post' + (count !== 1 ? 's have' : ' has') + ' been forwarded to the ' +
      'corporate review team. No action is needed from you at this time.</p>' +

      postsHtml +

      '<div style="text-align:center;margin:24px 0 8px 0;">' +
      '<a href="' + escapeHtmlAttr_(portalUrl) + '" ' +
      'style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;' +
      'font-size:15px;font-weight:700;padding:12px 28px;border-radius:8px;">' +
      'View your full calendar &rarr;</a>' +
      '</div>' +
      '</div>' +

      '<div style="background:#f8f9fb;border-top:1px solid #e8eaef;padding:14px 28px;' +
      'font-size:12px;color:#888;">' +
      'Sent by Anthology FINN Partners &bull; IES-TEXA Social Media Approval Tool' +
      '</div>' +
      '</div></div></div>';

    var plainBody = count + ' post' + (count !== 1 ? 's' : '') + ' sent to corporate review.\n\n';
    posts.forEach(function (p, i) {
      plainBody += (i + 1) + '. ' + (p.Title || '(untitled)') + '\n';
    });
    plainBody += '\nNo action is needed from you at this time.' +
      '\n\nView your review portal: ' + portalUrl + '\n\nAnthology FINN Partners';

    try {
      sendEmail_({
        to: ap.Email,
        subject: subject,
        body: plainBody,
        htmlBody: htmlBody,
        name: 'Anthology FINN Partners'
      });
    } catch (err) {
      console.error('sendLocalCorpBatchFYIEmail to ' + ap.Email + ' failed: ' + err.message);
    }
  });
}

/**
 * Notifies agency that the local client has sent posts to corporate review.
 * Sent immediately when local clicks "Send to Corporate" in their toolbar.
 * @param {Array<Object>} posts - posts that were sent to corporate
 * @param {string} localApproverName - display name of the local approver who triggered the send
 */
function sendAgencyCorpSentFYIEmail(posts, localApproverName) {
  var recipients = CONFIG.AGENCY_NOTIFICATION_EMAILS;
  if (!recipients || !recipients.length || !posts || !posts.length) return;
  var count = posts.length;
  var subject = '[IES-TEXA] Local sent ' + count + ' post' + (count !== 1 ? 's' : '') +
    ' to corporate review';

  var postsHtml = '';
  posts.forEach(function (post, idx) {
    var scheduled = post.Scheduled_Date
      ? formatDateValue(post.Scheduled_Date, 'EEEE, MMMM d, yyyy')
      : 'Not scheduled';
    postsHtml +=
      '<div style="border:1px solid #e0e0e0;border-radius:6px;padding:14px;' +
      'margin-bottom:10px;background:#fff;">' +
      '<div style="font-size:15px;font-weight:700;color:#1a1a2e;margin-bottom:4px;">' +
      (idx + 1) + '. ' + escapeHtml_(post.Title || '(untitled)') + '</div>' +
      '<div style="font-size:13px;color:#666;">Scheduled: ' + escapeHtml_(scheduled) + '</div>' +
      '</div>';
  });

  var agencyPortalUrl = CONFIG.APP_URL;

  var htmlBody =
    '<div style="margin:0;padding:0;background:#f4f5f7;">' +
    '<div style="max-width:600px;margin:0 auto;padding:24px;' +
    'font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">' +
    '<div style="background:#ffffff;border-radius:12px;border:1px solid #e0e0e0;overflow:hidden;">' +

    '<div style="background:#1a1a2e;padding:20px 28px;">' +
    '<div style="color:#ffffff;font-size:18px;font-weight:700;">IES-TEXA</div>' +
    '<div style="color:#9aa0b4;font-size:12px;margin-top:4px;">Agency Notification</div>' +
    '</div>' +

    '<div style="padding:28px;">' +
    '<div style="background:#6366F1;color:#fff;border-radius:8px;' +
    'padding:14px 20px;font-size:17px;font-weight:700;margin-bottom:20px;">' +
    escapeHtml_(localApproverName || 'Local approver') + ' sent ' +
    count + ' post' + (count !== 1 ? 's' : '') + ' to corporate review</div>' +

    '<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 20px 0;">' +
    'The local client triggered the corporate review send directly. ' +
    'The following post' + (count !== 1 ? 's are' : ' is') + ' now in ' +
    'Corporate Review. No action is required from you unless corporate ' +
    'requests changes.</p>' +

    postsHtml +

    '<div style="text-align:center;margin:24px 0 8px 0;">' +
    '<a href="' + escapeHtmlAttr_(agencyPortalUrl) + '" ' +
    'style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;' +
    'font-size:15px;font-weight:700;padding:12px 28px;border-radius:8px;">' +
    'Open agency portal &rarr;</a>' +
    '</div>' +
    '</div>' +

    '<div style="background:#f8f9fb;border-top:1px solid #e8eaef;padding:14px 28px;' +
    'font-size:12px;color:#888;">' +
    'Sent by Anthology FINN Partners &bull; IES-TEXA Social Media Approval Tool' +
    '</div>' +
    '</div></div></div>';

  var plainBody = (localApproverName || 'Local approver') + ' sent ' + count +
    ' post' + (count !== 1 ? 's' : '') + ' to corporate review.\n\n';
  posts.forEach(function (p, i) {
    plainBody += (i + 1) + '. ' + (p.Title || '(untitled)') + '\n';
  });
  plainBody += '\nNo action required from you unless corporate requests changes.' +
    '\n\nOpen agency portal: ' + agencyPortalUrl + '\n\nAnthology FINN Partners';

  try {
    sendEmail_({
      to: recipients.join(','),
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody,
      name: 'Anthology FINN Partners'
    });
    console.log('sendAgencyCorpSentFYIEmail: sent to ' + recipients.join(', '));
  } catch (err) {
    console.error('sendAgencyCorpSentFYIEmail failed: ' + err.message);
  }
}

/**
 * Sends a corporate decisions digest to either local approvers or agency.
 * One email per recipient covering all posts corporate acted on since last send.
 *
 * @param {Array<{Email:string, Name?:string, Access_Token?:string}>} recipients
 * @param {Array<{post:Object, approverName:string, decision:string, notes:string}>} decisions
 * @param {boolean} isAgency - true = agency email (no portal link needed), false = local client email
 */
function sendCorporateBatchResultsEmail(recipients, decisions, isAgency) {
  if (!recipients || !recipients.length || !decisions || !decisions.length) return;
  var count = decisions.length;
  var subject = '[IES-TEXA] Corporate review complete — ' + count + ' post' +
    (count !== 1 ? 's' : '') + ' updated';

  // Build the per-post decision rows.
  function decisionsHtml() {
    var html = '';
    decisions.forEach(function (d, idx) {
      var post = d.post;
      var isApproved = String(d.decision) === 'Approved';
      var decisionColor = isApproved ? '#4CAF50' : '#FF6B35';
      var decisionLabel = isApproved ? '✓ Approved' : '↩ Changes Requested';
      var scheduled = post.Scheduled_Date
        ? formatDateValue(post.Scheduled_Date, 'EEEE, MMMM d, yyyy')
        : 'Not scheduled';
      html +=
        '<div style="border:1px solid #e0e0e0;border-radius:6px;padding:14px 16px;' +
        'margin-bottom:10px;background:#fff;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;' +
        'gap:10px;flex-wrap:wrap;margin-bottom:6px;">' +
        '<div style="font-size:15px;font-weight:700;color:#1a1a2e;">' +
        (idx + 1) + '. ' + escapeHtml_(post.Title || '(untitled)') + '</div>' +
        '<span style="background:' + decisionColor + ';color:#fff;font-size:12px;' +
        'font-weight:700;padding:3px 10px;border-radius:12px;white-space:nowrap;">' +
        escapeHtml_(decisionLabel) + '</span>' +
        '</div>' +
        '<div style="font-size:12px;color:#888;margin-bottom:' +
        (d.notes ? '6px' : '0') + ';">Scheduled: ' + escapeHtml_(scheduled) +
        ' &bull; Reviewed by: ' + escapeHtml_(d.approverName) + '</div>' +
        (d.notes
          ? '<div style="font-size:13px;color:#555;background:#f8f9fb;border-left:3px solid #9C27B0;' +
            'padding:8px 12px;border-radius:0 4px 4px 0;margin-top:4px;">' +
            escapeHtml_(d.notes) + '</div>'
          : '') +
        '</div>';
    });
    return html;
  }

  recipients.forEach(function (recipient) {
    var portalUrl = isAgency
      ? CONFIG.APP_URL
      : CONFIG.APP_URL + '?page=client&token=' + encodeURIComponent(recipient.Access_Token || '');
    var portalLabel = isAgency ? 'Open agency portal' : 'View your full calendar';
    var intro = isAgency
      ? 'Corporate has completed their review. Here is a summary of all decisions made.'
      : 'The corporate review team has submitted their decisions on the following posts.';

    var htmlBody =
      '<div style="margin:0;padding:0;background:#f4f5f7;">' +
      '<div style="max-width:600px;margin:0 auto;padding:24px;' +
      'font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">' +
      '<div style="background:#ffffff;border-radius:12px;border:1px solid #e0e0e0;overflow:hidden;">' +

      '<div style="background:#1a1a2e;padding:20px 28px;">' +
      '<div style="color:#ffffff;font-size:18px;font-weight:700;">IES-TEXA</div>' +
      '<div style="color:#9aa0b4;font-size:12px;margin-top:4px;">Corporate Review Summary</div>' +
      '</div>' +

      '<div style="padding:28px;">' +
      '<div style="background:#9C27B0;color:#fff;border-radius:8px;' +
      'padding:14px 20px;font-size:17px;font-weight:700;margin-bottom:20px;">' +
      'Corporate review complete &mdash; ' + count + ' post' + (count !== 1 ? 's' : '') + '</div>' +

      '<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 20px 0;">' +
      escapeHtml_(intro) + '</p>' +

      decisionsHtml() +

      '<div style="text-align:center;margin:24px 0 8px 0;">' +
      '<a href="' + escapeHtmlAttr_(portalUrl) + '" ' +
      'style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;' +
      'font-size:15px;font-weight:700;padding:12px 28px;border-radius:8px;">' +
      escapeHtml_(portalLabel) + ' &rarr;</a>' +
      '</div>' +
      '</div>' +

      '<div style="background:#f8f9fb;border-top:1px solid #e8eaef;padding:14px 28px;' +
      'font-size:12px;color:#888;">' +
      'Sent by Anthology FINN Partners &bull; IES-TEXA Social Media Approval Tool' +
      '</div>' +
      '</div></div></div>';

    var plainBody = 'Corporate review complete — ' + count + ' post' +
      (count !== 1 ? 's' : '') + ' updated.\n\n';
    decisions.forEach(function (d, i) {
      var isApproved = String(d.decision) === 'Approved';
      plainBody += (i + 1) + '. ' + (d.post.Title || '(untitled)') +
        ' — ' + (isApproved ? 'Approved' : 'Changes Requested') +
        ' (by ' + d.approverName + ')' +
        (d.notes ? '\n   Note: ' + d.notes : '') + '\n';
    });
    plainBody += '\n' + escapeHtml_(intro) +
      '\n\nView portal: ' + portalUrl + '\n\nAnthology FINN Partners';

    try {
      sendEmail_({
        to: recipient.Email,
        subject: subject,
        body: plainBody,
        htmlBody: htmlBody,
        name: 'Anthology FINN Partners'
      });
      console.log('sendCorporateBatchResultsEmail: sent to ' + recipient.Email);
    } catch (err) {
      console.error('sendCorporateBatchResultsEmail to ' + recipient.Email + ': ' + err.message);
    }
  });
}
