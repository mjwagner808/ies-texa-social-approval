/**
 * Config.gs
 * Anthology FINN Partners — IES-TEXA Social Post Approval Tool
 * Global configuration constants.
 */

const CONFIG = {
  SPREADSHEET_ID: '1o9YpN7rzbQ_uwwXsuCMVwmhdMBpf8o9fILPnqu-cyR0', // MJ fills this in
  APP_URL: 'https://script.google.com/macros/s/AKfycbznHLabQnvBCmMHDKwA7WwiVQJtgzOC93UcXoUZ73AFXI4CjoqjVxfCCi4XN4Lf0rDB2g/exec', // MJ fills this in after deployment
  // SendGrid FROM address — must be verified in SendGrid (domain or single sender)
  // API key goes in Script Properties (Project Settings → Script Properties → SENDGRID_API_KEY)
  SENDGRID_FROM_EMAIL: 'anthologysocial@finnpartners.com',
  AGENCY_NOTIFICATION_EMAILS: [
    'mj.wagner@finnpartners.com',
    'courtney.kiehm@finnpartners.com',
    'jackie.smythe@finnpartners.com'
  ],
  CLIENT_ID: 'CLT-IES001',
  CLIENT_NAME: 'IES-TEXA',
  TIMEZONE: 'Pacific/Honolulu', // Hawaiʻi Standard Time (UTC-10, no daylight saving)
  SHEETS: {
    POSTS: 'Posts',
    APPROVALS: 'Post_Approvals',
    COMMENTS: 'Comments',
    NOTIFICATION_QUEUE: 'Notification_Queue',
    AUTHORIZED_CLIENTS: 'Authorized_Clients',
    CLIENTS: 'Clients',
    USERS: 'Users'
  },
  STATUSES: {
    DRAFT: 'Draft',
    INTERNAL: 'Internal_Review',        // kept for backward compat; UI uses Draft only
    REVISING: 'Revising',               // agency revising after client change request
    AWAITING_LOCAL: 'Awaiting_Local',   // agency marked ready for Local; waiting on explicit Send to Local Client
    LOCAL_CLIENT: 'Local_Client_Review',
    AWAITING_CORPORATE: 'Awaiting_Corporate', // local approved; waiting for agency or local to send to corporate
    CORPORATE: 'Corporate_Review',
    APPROVED: 'Approved',
    PUBLISHED: 'Published'
  },
  STATUS_COLORS: {
    Draft: '#9E9E9E',
    Internal_Review: '#9E9E9E',         // same as Draft (backward compat)
    Revising: '#0D9488',                // teal — clearly distinct from orange (Local) and purple (Corporate)
    Awaiting_Local: '#CA8A04',          // muted gold — "waiting to go to Local", parallel to Awaiting_Corporate's indigo
    Local_Client_Review: '#FF9800',
    Awaiting_Corporate: '#6366F1',      // indigo — "waiting to go to corporate"
    Corporate_Review: '#9C27B0',
    Approved: '#4CAF50',
    Published: '#1B5E20'
  },
  // Statuses considered "done" — cards visually muted on all calendars.
  DONE_STATUSES: ['Approved', 'Published'],
  STAGES: {
    INTERNAL: 'Internal',
    LOCAL_CLIENT: 'Local_Client',
    CORPORATE: 'Corporate'
  },
  APPROVAL_STATUSES: {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    CHANGES_REQUESTED: 'Changes_Requested'
  },
  COMMENT_TYPES: {
    INTERNAL: 'Internal',
    CLIENT_REPLY: 'Client_Reply',
    CORPORATE_REPLY: 'Corporate_Reply'
  },
  ACCESS_LEVELS: {
    LOCAL: 'Local',
    CORPORATE: 'Corporate'
  },
  ROLES: {
    ADMIN: 'Admin',
    VIEWER: 'Viewer'
  },
  ID_PREFIXES: {
    Posts: 'POST',
    Post_Approvals: 'APR',
    Comments: 'CMT',
    Notification_Queue: 'NTF',
    Authorized_Clients: 'AC',
    Clients: 'CLT',
    Users: 'USR'
  },
  PLATFORMS: ['LinkedIn', 'Facebook', 'Instagram'],
  // Delivery channels for corporate notifications. A given send can use one or both.
  DELIVERY_CHANNELS: {
    EMAIL: 'Email',
    URL: 'URL',
    BOTH: 'Both'
  },
  // Query param appended to a corporate approver's portal link when it is being
  // hand-delivered through their communications platform instead of emailed.
  // ClientPortal.html checks this to decide whether to show the optional source
  // tag (on comments) and the required decided-by name (on approve/request changes).
  URL_DELIVERY_PARAM: 'via',
  URL_DELIVERY_VALUE: 'link',
  // Placeholder examples shown in the optional "Responding as" source tag field.
  SOURCE_TAG_EXAMPLES: 'e.g., Legal, Communications',
  // Days of no corporate send activity before the agency toolbar shows a
  // "nothing sent to corporate in a while" indicator.
  CORP_SEND_STALENESS_DAYS: 3
};

/**
 * Maps a post status to the approval stage it represents (if any).
 * @param {string} status
 * @return {string|null} stage value or null
 */
function statusToStage(status) {
  if (status === CONFIG.STATUSES.INTERNAL) return CONFIG.STAGES.INTERNAL;
  if (status === CONFIG.STATUSES.LOCAL_CLIENT) return CONFIG.STAGES.LOCAL_CLIENT;
  if (status === CONFIG.STATUSES.CORPORATE) return CONFIG.STAGES.CORPORATE;
  return null;
}

/**
 * Maps a client access level to the post status that level reviews.
 * @param {string} accessLevel - 'Local' or 'Corporate'
 * @return {string} post status
 */
function accessLevelToStatus(accessLevel) {
  return accessLevel === CONFIG.ACCESS_LEVELS.CORPORATE
    ? CONFIG.STATUSES.CORPORATE
    : CONFIG.STATUSES.LOCAL_CLIENT;
}

/**
 * Maps a client-visible review status to its "waiting to be sent" holding
 * status. A post sits here — invisible to the client — from the moment the
 * agency marks it ready until someone explicitly clicks Send. Added 2026-07-09
 * to close a gap where the agency's manual status dropdown could set a post
 * straight to a client-visible status with no explicit send required (this had
 * always been true for Corporate_Review picked directly from the dropdown, and
 * was the same root bug MJ noticed with Local Client Review).
 * @param {string} reviewStatus - CONFIG.STATUSES.LOCAL_CLIENT or CORPORATE
 * @return {string|null} the matching Awaiting_ status, or null if not applicable
 */
function awaitingStatusFor_(reviewStatus) {
  if (reviewStatus === CONFIG.STATUSES.LOCAL_CLIENT) return CONFIG.STATUSES.AWAITING_LOCAL;
  if (reviewStatus === CONFIG.STATUSES.CORPORATE) return CONFIG.STATUSES.AWAITING_CORPORATE;
  return null;
}

/**
 * Maps a client access level to its approval stage.
 * @param {string} accessLevel
 * @return {string} stage value
 */
function accessLevelToStage(accessLevel) {
  return accessLevel === CONFIG.ACCESS_LEVELS.CORPORATE
    ? CONFIG.STAGES.CORPORATE
    : CONFIG.STAGES.LOCAL_CLIENT;
}

/**
 * Given a review status, returns the status the post advances to when
 * all approvers at that stage have approved.
 * @param {string} status
 * @return {string|null}
 */
function nextStatusAfterApproval(status) {
  if (status === CONFIG.STATUSES.LOCAL_CLIENT) return CONFIG.STATUSES.AWAITING_CORPORATE;
  if (status === CONFIG.STATUSES.CORPORATE) return CONFIG.STATUSES.APPROVED;
  return null;
}

/**
 * Maps a target review status to the Authorized_Clients Access_Level
 * whose approvers handle that stage.
 * @param {string} status
 * @return {string|null}
 */
function statusToAccessLevel(status) {
  if (status === CONFIG.STATUSES.LOCAL_CLIENT) return CONFIG.ACCESS_LEVELS.LOCAL;
  if (status === CONFIG.STATUSES.CORPORATE) return CONFIG.ACCESS_LEVELS.CORPORATE;
  return null;
}

/**
 * Formats a Date (or date-like value) into a consistent display string.
 * @param {Date|string} value
 * @param {string} [pattern]
 * @return {string}
 */
function formatDateValue(value, pattern) {
  if (value === null || value === undefined || value === '') return '';
  var d = (value instanceof Date) ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return Utilities.formatDate(d, CONFIG.TIMEZONE, pattern || 'yyyy-MM-dd HH:mm:ss');
}
