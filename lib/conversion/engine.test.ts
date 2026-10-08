import {describe,it,expect} from "vitest";
import {decideConversion,type ConversionInput} from "./engine";
const base:ConversionInput={event:"scan_started",identity:{tenantId:"tenant",anonymousId:"visitor"},scan:{id:"scan",terminal:false},contact:{email:"p@example.com",consentForFollowUp:true,unsubscribed:false,suppressed:false},history:{now:"2026-10-08T12:00:00Z",alreadyContactedForScan:false}};
describe("conversion guardrails",()=>{
 it("requires identity",()=>expect(decideConversion({...base,identity:{tenantId:""}}).action).toBe("none"));
 it("only shows terminal reports",()=>{expect(decideConversion({...base,event:"scan_completed",scan:{id:"scan",terminal:false,reportUrl:"/report"}}).action).toBe("none");expect(decideConversion({...base,event:"scan_completed",scan:{id:"scan",terminal:true,reportUrl:"/report"}}).action).toBe("show_report")});
 it("does not upsell entitled customers",()=>expect(decideConversion({...base,event:"report_viewed",account:{registered:true,activeEntitlement:true}}).action).toBe("none"));
 it("offers signup and upgrade separately",()=>{expect(decideConversion({...base,event:"report_viewed",account:{registered:false,activeEntitlement:false}}).action).toBe("show_signup");expect(decideConversion({...base,event:"report_viewed",account:{registered:true,activeEntitlement:false}}).action).toBe("show_upgrade")});
 it.each([{consentForFollowUp:false},{unsubscribed:true},{suppressed:true}])("respects outreach blocks %j",patch=>expect(decideConversion({...base,contact:{...base.contact!,...patch}}).action).toBe("none"));
 it("blocks duplicate or recent contacts",()=>{expect(decideConversion({...base,history:{...base.history!,alreadyContactedForScan:true}}).action).toBe("none");expect(decideConversion({...base,history:{...base.history!,latestContactAt:"2026-10-07T12:00:00Z"}}).action).toBe("none")});
 it("generates stable scoped keys",()=>{const x=decideConversion(base);expect(x.action).toBe("queue_follow_up");expect(x.dedupeKey).toBe(decideConversion(base).dedupeKey);expect(x.dedupeKey).not.toBe(decideConversion({...base,scan:{id:"scan2",terminal:false}}).dedupeKey)});
 it("offers recovery on failed checkout",()=>expect(decideConversion({...base,event:"checkout_failed"}).action).toBe("show_support"));
});
