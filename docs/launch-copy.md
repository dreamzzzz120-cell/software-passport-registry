# Launch copy — homepage block and 60-second script

Every sentence below claims only what the product does today. Rejected from
the source kit: VEX ("smart suppression"), scanning software "running on
client networks", mapping closed-source vendor tools, "cryptographic
passport", and every invented dollar figure. See `docs/whitepaper-software-vin.md`
for the long form.

---

## Homepage block

**Eyebrow:** A VIN for software

**Headline:** Stop taking the vendor's word for it.

**Sub-headline:** Software Passport Registry observes what is actually inside
the software you run — and keeps the evidence.

### The problem
When a client asks "is this tool safe to keep?", the honest answer today is
assembled from a vendor's security page, a questionnaire answered by sales,
and maybe a scan somebody ran once. None of it is observed; none of it is
kept. SolarWinds and Log4j were not failures of firewalls. They were failures
of knowing what was inside.

### What SPR does
Point it at a repository. SPR acquires the exact commit, builds a CycloneDX
bill of materials with Syft, checks every component against the OSV
vulnerability database, and scans the tree for secrets, infrastructure
misconfiguration and licence signals. Every observation is stored as evidence
with a hash, a source and a timestamp, and the passport is re-observed over
time. No vendor permission needed.

### How it works (three tiles)

**1. Identity, not a name.** A passport is bound to a specific commit or
version — the bytes that were examined — never "the latest".

**2. Observation, not assertion.** SBOM, vulnerabilities, secrets, licences:
each a recorded evidence item. If SPR has not looked at something, it says so.
It never shows a score it did not measure.

**3. Claimed is not verified.** A closed ticket moves a finding to *claimed*.
Only a fresh observation moves it to *verified*. Enforced in code, not policy.

### For MSPs
Run it across your clients' software under your own branding, give clients
plain-English and auditor-ready reports with the evidence one click away,
and get told when a re-observation changes. Plans are priced by client
count; see the live prices on the Pricing page — they are read from the
system that charges them.

**Buttons:** Review a public repository free · See plans · Read the whitepaper

---

## 60-second script

**0:00–0:15 — Hook** *(headlines: SolarWinds, Log4j; a dependency tree)*
"You run firewalls. You monitor endpoints. But the software itself — the
tool your client depends on — is still a black box. You are trusting a
vendor's PDF."

**0:15–0:30 — The problem** *(engineer, spreadsheet of vendor questionnaires)*
"Every application carries hundreds of third-party components. When the next
Log4j lands, the questionnaire from last year won't tell you whether you're
exposed. You need to know what was actually inside — at a specific version,
on a specific date."

**0:30–0:45 — The product** *(screen: free review running; SBOM count, findings, evidence appear)*
"Software Passport Registry gives software a VIN. Point it at a repository:
it builds the bill of materials, checks every component against the OSV
vulnerability database, scans for secrets and licence problems, and stores
every observation as evidence with a hash and a timestamp. If it hasn't
looked, it says so. It never invents a score."

**0:45–1:00 — Call to action** *(MSP dashboard, branded report)*
"Run it across your clients' software under your own brand. Hand them the
evidence, not a promise. Start with a free review of any public repository
at softwarepassportregistry.com."

---

## Numbers you may cite (true as of 2026-09-12)

- 94+ open-source projects reviewed and published at `/software`, each at a
  specific commit.
- Plan prices: read live at `/pricing` (do not restate them in copy).
- "Zero" is a number the product shows only when it measured zero.
