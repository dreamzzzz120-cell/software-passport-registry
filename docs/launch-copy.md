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

---

## Posts (paste-ready; every claim is observed behaviour of the product)

Rules of the road: say plainly that you built it. Reply to every comment.
Never claim a repository is "safe" — SPR reports what it observed. r/msp
permits vendor posts that are useful and transparent; r/sysadmin generally
removes self-promotion, so post there only as a question-led discussion.

### r/msp

**Title:** I built a free tool that gives software a "VIN" — SBOM + vulnerability + secrets + licence evidence for any public repo. Looking for MSP feedback.

Hi r/msp — founder here, being upfront that this is my product.

The problem I kept hitting: when a client asks "is this tool safe to keep?",
the answer is assembled from a vendor's security page and a questionnaire.
Nothing in it was observed, and nothing is kept.

So I built Software Passport Registry. Point it at a public GitHub repo and it:

- acquires the exact commit,
- builds a CycloneDX bill of materials with Syft,
- checks every component against the OSV vulnerability database,
- scans the tree for secrets, IaC misconfiguration and licence signals,
- stores every observation as an evidence item with a hash and a timestamp.

The rule I'm strictest about: it never shows a number it didn't measure. If a
scan fails, it says "failed" with zero counts meaning "nothing scanned" —
not a clean bill of health. Areas with no collector say "not observed".

The free review is here (no signup): https://www.softwarepassportregistry.com/
Ninety-odd popular open-source projects already reviewed, each pinned to a
commit: https://www.softwarepassportregistry.com/software

For MSPs there are white-label plans priced by client count, and I put up a
calculator where you enter your own client count and price — it pulls my real
prices, it does not invent your revenue:
https://www.softwarepassportregistry.com/roi

What I'd like to know from you: what would a client actually need to see in
the report for it to be worth a line item on their invoice? Brutal answers
welcome — I'd rather hear it now.

### r/sysadmin (question-led; no pricing, no pitch)

**Title:** How do you actually verify what's inside a third-party tool before you approve it?

Genuine question. Our process was "read the vendor security page, send the
questionnaire, approve." After Log4j that felt hollow: the questionnaire from
last year says nothing about what's in the build you're running today.

I ended up building something that pins a repo to a commit, generates an SBOM
(Syft), runs every component through OSV, and keeps the evidence with hashes —
it's free for public repos and I'm happy to share the link in comments if
that's allowed, but I'm more interested in what everyone else does.

Do you SBOM vendor tools? Do you re-check on every version? Or is it
questionnaire-and-pray like it was for us?

### Show HN

**Title:** Show HN: Software Passport Registry – a "VIN" for software, built from observed evidence only

Point it at a public GitHub repo and it acquires the exact commit, generates a
CycloneDX SBOM with Syft, checks every component against OSV, scans for
secrets / IaC misconfiguration / licence signals, and stores each observation
as evidence with a hash and timestamp. Free, no signup, results are public
and pinned to a commit: https://www.softwarepassportregistry.com/software

Design rule: it never displays a value it did not measure. Failed scan → "failed",
with zero counts meaning nothing was scanned. Categories with no collector →
"not observed", excluded from the average rather than scored 100. The scoring
is deterministic and the weights are in the source.

Things it does not do (yet): it doesn't verify signatures or provenance, so the
"cryptographically verified" share of evidence is honestly 0 for every repo,
which caps the supply-chain category at 70. Private repos require connecting
GitHub. No VEX.

Stack: Express + Postgres (row-level security per tenant), Syft 1.49, OSV,
React front end. Solo founder; happy to answer anything.

### LinkedIn

You run firewalls. You monitor endpoints. But the software itself — the tool
your client depends on — is still a black box you're taking a vendor's PDF for.

I built Software Passport Registry to change one thing: replace assertion
with observation. Point it at a repository and it records what is actually
inside — bill of materials, known vulnerabilities, secrets, licences — as
evidence with a hash and a timestamp, pinned to a specific commit.

It never shows a number it didn't measure. That's the whole product.

Free review of any public repository, no signup:
https://www.softwarepassportregistry.com

Whitepaper on the idea of a VIN for software:
https://www.softwarepassportregistry.com/whitepaper

If you run an MSP and want to offer this to clients under your own brand,
message me.
