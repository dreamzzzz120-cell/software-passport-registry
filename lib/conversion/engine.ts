/** Side-effect-free, evidence-first conversion recommendations. Never sends mail or grants access. */
export type ConversionInput = {
 event: "scan_started"|"scan_completed"|"report_viewed"|"signup_completed"|"checkout_started"|"checkout_completed"|"login_failed"|"checkout_failed";
 identity: {tenantId:string;actorId?:string;anonymousId?:string};
 scan?: {id:string;terminal:boolean;reportUrl?:string};
 account?: {registered:boolean;activeEntitlement:boolean};
 contact?: {email?:string;consentForFollowUp:boolean;unsubscribed:boolean;suppressed:boolean};
 history?: {alreadyContactedForScan:boolean;latestContactAt?:string;now:string};
};
export type Decision = {action:"none"|"show_report"|"show_signup"|"show_upgrade"|"show_support"|"queue_follow_up";reason:string;dedupeKey?:string;message?:string};
export function decideConversion(input:ConversionInput):Decision {
 const none=(reason:string):Decision=>({action:"none",reason});
 if(!input.identity.tenantId||(!input.identity.actorId&&!input.identity.anonymousId))return none("identity_not_bound");
 if(input.event==="login_failed"||input.event==="checkout_failed")return {action:"show_support",reason:"recover_blocked_user"};
 if(input.account?.activeEntitlement)return none("already_entitled");
 if(input.event==="scan_completed"){
  if(!input.scan?.id||!input.scan.terminal||!input.scan.reportUrl)return none("report_not_available");
  return {action:"show_report",reason:"report_available",message:"View your evidence-backed scan report. Unknown findings stay unknown."};
 }
 if(input.event==="report_viewed"){
  if(!input.account?.registered)return {action:"show_signup",reason:"save_report",message:"Create an account to save your report."};
  return {action:"show_upgrade",reason:"ongoing_monitoring",message:"Add continuous monitoring and client-ready reporting. See plan terms before purchasing."};
 }
 if(input.event!=="scan_started"||!input.scan?.id)return none("not_eligible");
 const c=input.contact;
 if(!c?.email||!c.consentForFollowUp||c.unsubscribed||c.suppressed)return none("no_contact_permission");
 if(!input.history?.now||!Number.isFinite(Date.parse(input.history.now)))return none("time_unverified");
 if(input.history.alreadyContactedForScan)return none("already_contacted");
 if(input.history.latestContactAt){
  const last=Date.parse(input.history.latestContactAt);
  if(!Number.isFinite(last)||Date.parse(input.history.now)-last<7*86400000)return none("contact_cooldown");
 }
 return {action:"queue_follow_up",reason:"consented_scan_incomplete",dedupeKey:["conversion-followup-v1",input.identity.tenantId,input.scan.id].map(encodeURIComponent).join(":"),message:"Your software scan is unfinished. Resume it when you're ready."};
}
