#!/usr/bin/env node
/* Simple smoke test: parse Template 1, render Template 2, assert key fields */

function cleanText(input){
  return (input || "")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function sectionBetween(text, start, end){
  const sidx = text.indexOf(start);
  if(sidx === -1) return "";
  const from = sidx + start.length;
  if(!end) return text.slice(from);
  const eidx = typeof end === 'string' ? text.indexOf(end, from) : text.slice(from).search(end);
  if(eidx === -1) return text.slice(from);
  return typeof end === 'string' ? text.slice(from, eidx) : text.slice(from, from + eidx);
}
function formatDate(d){
  const dt = d instanceof Date ? d : new Date(d);
  const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()];
  return `${m} ${String(dt.getDate()).padStart(2,'0')}, ${dt.getFullYear()}`;
}
function formatTime(d){
  const dt = d instanceof Date ? d : new Date(d);
  let h = dt.getHours(); const m = String(dt.getMinutes()).padStart(2,'0'); const am = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${String(h).padStart(2,'0')}:${m} ${am}`;
}
function parseTemplate1Incident(raw){
  const text = cleanText(raw);
  const now = new Date();
  const cap = sectionBetween(text, "*Captain Profile", "*Customer Profile");
  const cust = sectionBetween(text, "*Customer Profile", "Actions Taken:");
  const actions = sectionBetween(text, "Actions Taken:", "Requested for pair Blocking:");
  const capAct = sectionBetween(actions, "Captain:", "Customer:");
  const custAct = sectionBetween(actions, "Customer:", "Requested for pair Blocking:");

  const fields = {
    incident_category: "",
    date_report_received: formatDate(now),
    time_report_received: formatTime(now),
    date_of_incident: "",
    time_of_incident: "",
    case_status: "Open",
    l4_classification: "No",
    key_incident_details: "",
    incident_type: "",
    city: "",
    country: "",
    booking_id: "",
    zendesk_ticket_id: "",
    reason: "",
    captain_history_rating: "",
    tenure_range: "",
    trip_count_monthly: "",
    trip_count_total: "",
    captain_ssoc_related: "",
    captain_not_ssoc_related: "",
    captain_blocking_duration_completed: "",
    captain_acceptance_rate: "",
    customer_history_rating: "",
    customer_trip_count_6m: "",
    customer_prev_underpayments: "",
    customer_prev_complaints_on_captains: "",
    customer_investigation_summary: "",
    action_with_customer: "",
    captain_investigation_summary: "",
    action_with_captain: "",
  };

  // Captain profile
  const tripsM = cap.match(/Trips:\s*(\d+)\s*\/\s*(\d+)/i);
  if(tripsM){ fields.trip_count_monthly = tripsM[1]; fields.trip_count_total = tripsM[2]; }
  const tenureM = cap.match(/Tenure[\s\S]*?\(\s*(\d+)\s*-\s*(\d+)\s*\)/i);
  if(tenureM){ fields.tenure_range = `${tenureM[1]} - ${tenureM[2]}`; }
  const ratingM = cap.match(/Rating:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if(ratingM){ fields.captain_history_rating = ratingM[1]; }
  const blockHistIdx = cap.indexOf("Block History");
  if(blockHistIdx !== -1){
    const after = cap.slice(blockHistIdx);
    const lines = after.split(/\n+/).slice(1);
    const items = [];
    for(const ln of lines){
      const stop = /Past Trips Rating|\*/i.test(ln); if(stop) break;
      const t = ln.trim(); if(t) items.push(t);
    }
    const nonClear = items.filter(x => !/\bClear\b/i.test(x));
    fields.captain_ssoc_related = nonClear.length ? nonClear.join("\n") : (items.length ? "All Clear" : "");
  }

  // Customer profile
  const custRatingM = cust.match(/Rating of past trips:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if(custRatingM){ fields.customer_history_rating = custRatingM[1]; }
  if(/Other complaints\/?claims sent:\s*Clear/i.test(cust)){ fields.customer_prev_complaints_on_captains = "No"; }
  if(/Block History:\s*Clear/i.test(cust)){ fields.customer_prev_underpayments = "No"; }
  if(/Other Zendesk Ticket\/?s[\s\S]*?:\s*none/i.test(cust)){ fields.zendesk_ticket_id = ""; }

  // Actions taken
  const capCallM = capAct.match(/Call Summary and Reaction:\s*([\s\S]*?)(?:\n|$)/i);
  if(capCallM){ fields.captain_investigation_summary = capCallM[1].trim(); }
  const capOtherM = capAct.match(/Other Actions:\s*([\s\S]*?)(?:\n|$)/i);
  if(capOtherM){ fields.action_with_captain = capOtherM[1].trim(); }

  const custCallM = custAct.match(/Call Summary and Reaction:\s*([\s\S]*?)(?:\n|$)/i);
  if(custCallM){ fields.customer_investigation_summary = custCallM[1].trim(); }
  const custOtherM = custAct.match(/Other Actions:\s*([\s\S]*?)(?:\n|$)/i);
  if(custOtherM){ fields.action_with_customer = custOtherM[1].trim(); }

  // Derive a brief key details and reason from customer summary
  if(fields.customer_investigation_summary){
    fields.key_incident_details = fields.customer_investigation_summary.slice(0, 140) + (fields.customer_investigation_summary.length > 140 ? '…' : '');
    fields.reason = fields.customer_investigation_summary;
  }

  // Additional extractions
  const incCat1 = text.match(/Incident\s*Category\s*[:\-]?\s*\[?([^\]\n]+)\]?/i);
  const incCat2 = text.match(/I:Category\s*\(\s*([^)]+)\s*\)/i);
  if(incCat1){ fields.incident_category = incCat1[1].trim(); }
  else if(incCat2){ fields.incident_category = incCat2[1].trim(); }

  const incidentTypeM = text.match(/Incident\s*type\s*[:\-]?\s*([^\n]+)/i);
  if(incidentTypeM){ fields.incident_type = incidentTypeM[1].trim(); }

  const cityCountryM = text.match(/City\s*:\s*([^,\n]+)\s*,\s*Country\s*:\s*([^\n]+)/i);
  if(cityCountryM){
    fields.city = cityCountryM[1].trim();
    fields.country = cityCountryM[2].trim();
  } else {
    const cityM = text.match(/City\s*:\s*([^\n]+)/i);
    const countryM = text.match(/Country\s*:\s*([^\n]+)/i);
    if(cityM){ fields.city = cityM[1].trim(); }
    if(countryM){ fields.country = countryM[1].trim(); }
  }

  const bookingM = text.match(/\bBooking\s*ID\s*[:\-]?\s*(\d{5,})\b/i) || text.match(/\bB\.?\s*ID\s*[:\-]?\s*(\d{4,})\b/i);
  if(bookingM){ fields.booking_id = bookingM[1]; }

  const ticketM = text.match(/Zendesk\s*ticket\s*ID\s*[:\-]?\s*(\d{5,})\b/i) || text.match(/\bT\.?\s*ID\s*[:\-]?\s*(\d{4,})\b/i) || text.match(/Ticket\s*ID\s*[:\-]?\s*(\d{5,})\b/i);
  if(ticketM){ fields.zendesk_ticket_id = ticketM[1]; }

  return fields;
}

function getTemplatePlaceholders(template){
  const set = new Set();
  const re = /\{\{\s*([\w.]+)\s*\}\}/g; let m;
  while((m = re.exec(template))){ set.add(m[1]); }
  return Array.from(set);
}
function fillMissingKeys(obj, keys){
  const out = { ...obj }; keys.forEach(k => { if(!(k in out)) out[k] = ""; }); return out;
}
function renderTemplate(template, data){
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const value = key.split(".").reduce((acc, k) => acc && acc[k], data);
    return value == null || value === "" ? "" : String(value);
  });
}

const DEFAULT_TEMPLATE_2 = `Incident Category: [{{incident_category}}]
Date report received: {{date_report_received}}
Time report received: {{time_report_received}}
Date of incident: {{date_of_incident}}
Time of incident: {{time_of_incident}}
Case status: {{case_status}}
L4+ classification: {{l4_classification}}
Key incident details: {{key_incident_details}}
Incident type: {{incident_type}}
City: {{city}}, Country: {{country}}
Booking ID: {{booking_id}}
Zendesk ticket ID: {{zendesk_ticket_id}}
L4+ classification: {{l4_classification}}
Reason: {{reason}}
.........................................................................
Captain history rating: {{captain_history_rating}} /
Tenure : ( {{tenure_range}} )
Trip count:
MONTHLY / TOTAL TRIPS: {{trip_count_monthly}} / {{trip_count_total}}
Captain safety history:
SSOC related:
{{captain_ssoc_related}}
Not SSOC related:
{{captain_not_ssoc_related}}
Blocking Duration Completed
{{captain_blocking_duration_completed}}
acceptance_rate
{{captain_acceptance_rate}}
.........................................................................
Customer history rating: {{customer_history_rating}}
Trip count:
Past 6 months: {{customer_trip_count_6m}}
Customer history:
previously blocked for underpayments? {{customer_prev_underpayments}}
previous customer complains on captains? {{customer_prev_complaints_on_captains}}
.........................................................................
Customer investigation summary:
{{customer_investigation_summary}}
Action with customer: {{action_with_customer}}
Captain investigation summary:
{{captain_investigation_summary}}
Action with captain: {{action_with_captain}}`;

const TEMPLATE1 = String.raw`Dear Team,

Please be informed that we placed a call indicating the following details:
 
*Captain Profile
Trips: 5 / 148
Tenure:
( 0 - 6 )
Rating: 4.7 /
Tier: Bronze
Block History:
Sexual behaviour: Clear
Physical altercations: Clear
Road safety: Clear
Minor: Clear
Past Trips Rating: Clear
 
*Customer Profile
Joined Careem: 05 Sep 2025
Rating of past trips: 4.5
Block History: Clear
Other complaints/claims sent: Clear
Other Zendesk Ticket/s relating to the Booking ID, Ticket: none
 
Actions Taken:
 
Captain:
Call Summary and Reaction: No call
Other Actions: Not yet 
 
 
Customer:
Call Summary and Reaction: A customer called from this number and said that he was having a problem with the captain, even though he was late in delivering the order. He raised his voice and tried to hit him and did not respect him. We apologized to him and told him about the action he took, and he was satisfied.
Other Actions: Apology and educated about the emergency line
 
 
Requested for pair Blocking: Yes (L2-1954723)
Captain:  I:Category (....................),Type: - B. ID:Number - T. ID:Number - AINC/AIC/VINC/VIC - Safety & Security Operation
Customer:   I:Category (....................),Type: - B. ID:Number - T. ID:Number - AINC/AIC/VINC/VIC - Safety & Security Operation
Recorded:: No
Escalated: No
To: No one 
 
Next Steps:
- Follow up with Captain: Yes
For: take action 
 
- Follow up with customer: No
For: no need
 
- Recorded: Yes
 
Regards,
 
Safety & Security Operations Team`;

const placeholders = getTemplatePlaceholders(DEFAULT_TEMPLATE_2);
const fields = fillMissingKeys(parseTemplate1Incident(TEMPLATE1), placeholders);

const expectations = [
  ["trip_count_monthly", "5"],
  ["trip_count_total", "148"],
  ["captain_history_rating", "4.7"],
  ["tenure_range", "0 - 6"],
  ["customer_history_rating", "4.5"],
  ["captain_investigation_summary", "No call"],
  ["action_with_captain", "Not yet"],
  ["action_with_customer", /Apology/i],
];

const failures = [];
for(const [key, expected] of expectations){
  const actual = fields[key];
  if(expected instanceof RegExp){
    if(!expected.test(String(actual || ""))){ failures.push(`${key}: expected ${expected}, got ${JSON.stringify(actual)}`); }
  } else if(String(actual) !== String(expected)){
    failures.push(`${key}: expected ${expected}, got ${JSON.stringify(actual)}`);
  }
}

if(failures.length){
  console.error("Smoke test FAILED:\n" + failures.map(x=>" - "+x).join("\n"));
  process.exit(1);
}

console.log("Smoke test passed. Extracted fields:\n" + JSON.stringify(fields, null, 2));
console.log("\nRendered Template 2:\n\n" + renderTemplate(DEFAULT_TEMPLATE_2, fields));
