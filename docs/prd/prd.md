## **title: AI Condo Treasury Bot ("Fiduciary Watchdog")**

created: 2026-07-29 updated: 2026-07-29

# **PRD: AI Condo Treasury Bot ("Fiduciary Watchdog")**

**Status:** Final **Scope:** Early-Adopter Pilot

## **0\. Document Purpose**

This PRD defines the initial pilot scope for the AI Condo Treasury Bot. It establishes the architectural guardrails (a strict read-only air-gap and dual-LLM pattern) and outlines the conversational multi-agent interface. This document builds upon the initial technical handoff and serves as the definitive capability spec for the engineering and architecture workflows.

## **1\. Vision**

Volunteer condo and HOA boards carry significant fiduciary liability but lack the enterprise-grade financial oversight tools required to confidently govern. Recent legislation, such as Florida's HB 1021, has drastically increased the criminal penalties for directors who mismanage or fail to maintain accurate financial records, transforming volunteer governance into a high-risk liability trap.

The AI Condo Treasury Bot acts as a read-only "Fiduciary Watchdog." It ingests unstructured financial documents, passively triangulates dues, and detects vendor anomalies. By isolating all data extraction and strictly delegating financial arithmetic to deterministic code, the system provides a safe, conversational "Oracle" for the board. It delivers absolute financial clarity and provable compliance without ever handling active payment execution or assuming ledger-writing authority.

## **2\. Target User**

### **2.1 Jobs To Be Done**

**Persona 1: The Board Treasurer (Financial Operator)**

* **Functional:** Instantly verify member dues status and historical payments without manually building aging reports.  
* **Security:** Detect duplicate invoices, unusual vendor billing spikes, or fraudulent payment requests before approving them in the external banking portal.  
* **Compliance:** Maintain zero personal liability by relying on an automated, air-gapped system that proves fiduciary diligence.

**Persona 2: The Board President (Governance & Oversight)**

* **Functional:** Gain immediate, high-level visibility into the association's cash position and vendor health without waiting for the Treasurer's monthly report.  
* **Social/Emotional:** Defend board decisions with instant, audit-grade data retrieval during contentious board meetings or when fielding resident complaints.  
* **Risk Mitigation:** Ensure a secondary, impartial set of eyes (the Watchdog) is validating the association's financial health, protecting the entire board from claims of negligence.

### **2.2 Non-Users (v1)**

* **Property Managers:** This pilot is strictly for self-managed boards.  
* **Standard Condo Owners/Residents:** The system is an operational intelligence layer for the board, not a resident-facing portal.

### **2.3 Key User Journeys**

* **UJ-1. Sarah (Treasurer) catches a duplicate invoice before a payment run.**  
  * **Persona \+ context:** Sarah is reviewing a batch of end-of-month vendor invoices before logging into the bank to authorize payments.  
  * **Entry state:** Authenticated on the web dashboard.  
  * **Path:** She uploads a PDF invoice from the landscaping company. The system ingests it, extracts the data, and the Watchdog agent cross-references it against historical ledger data.  
  * **Climax:** The Watchdog flags the invoice as a likely duplicate, noting that a payment for the exact same amount and service period was cleared three weeks ago, despite a slightly altered invoice number.  
  * **Resolution:** Sarah rejects the invoice, prevents a double-payment out of the operating account, and exports the Watchdog's finding for the next board packet.  
* **UJ-2. David (President) defends a dues compliance action during a board meeting.**  
  * **Persona \+ context:** David is running a contentious board meeting where a resident is aggressively disputing their overdue balance.  
  * **Entry state:** Authenticated on a laptop during the live meeting.  
  * **Path:** David opens the Conversational Oracle and types, "What is the exact dues status and payment history for Unit 304 over the last 6 months?"  
  * **Climax:** The Oracle (delegating to deterministic SQL tools) instantly returns a mathematically perfect, formatted ledger showing exactly which months were missed and when partial payments were made.  
  * **Resolution:** David reads the audit-grade data aloud, instantly defusing the argument with objective facts, protecting the board's enforcement action.

## **3\. Glossary**

* **Air-Gap:** The non-negotiable architectural constraint that the system holds **no payment-rail or banking credentials of any kind** and therefore cannot move money, initiate or approve a payment, or alter any record in an external banking or accounting system. It is defined as an *absence* — there is no outbound write path to a financial institution — rather than as a permission setting that could later be widened. The air-gap does **not** restrict the system from writing to its own data store: the Watchdog owns and maintains its own database (uploaded documents, extracted records, alerts, and the query-provenance log), and must write to it to function.  
* **Conversational Oracle (or Oracle):** The primary multi-turn chat interface where users interact with the Fiduciary Watchdog.  
* **Deterministic Tooling:** Python or Node.js code/SQL scripts that execute financial math or database queries. The LLM is strictly prohibited from performing mathematical calculations itself.  
* **Dual-LLM Pattern:** The security architecture separating untrusted document extraction (using specialized Document AI) from privileged reasoning and tool execution.  
* **Dues Triangulation:** The automated process of comparing expected monthly assessments against actual read-only bank deposit data to identify delinquencies.  
* **Fiduciary Watchdog (or Watchdog):** The overarching persona of the AI system, encompassing both passive anomaly detection and active query responses.  
* **Zero-LLM Token Arithmetic:** The absolute prohibition of the LLM performing native mathematical calculations; all math is routed to Deterministic Tooling.

## **4\. Features**

### **4.1 Document Ingestion & Sanitization Pipeline**

**Description:** The isolated upstream process where untrusted financial documents are parsed and converted into strict structured data. This realizes the first half of UJ-1. To maintain the Dual-LLM Pattern, this extraction pipeline has zero access to Deterministic Tooling or ledger data.

#### **FR-1: Document Upload**

The Treasurer can upload financial documents as well as bulk data files via the web dashboard for analysis. Realizes UJ-1. **Consequences (testable):**

* System accepts PDF, PNG, JPG, CSV, and Excel formats.  
* System gracefully rejects unsupported file types or files exceeding size limits with a clear error message.  
* If a file is password-protected, encrypted, or illegible, the system halts ingestion and displays: *"This file cannot be read. It might be password protected or corrupted. Please upload an unlocked or clearer version."*

#### **FR-2: Upstream Extraction Isolation**

The system must extract text and key-value pairs from the uploaded document using an isolated Document AI service, completely bypassing the primary Fiduciary Watchdog reasoning model. **Consequences (testable):**

* Raw document bytes and raw OCR text are never passed directly into the context window of the tool-calling or reasoning agents.

#### **FR-3: Schema Conformance & Handoff**

The system forces the extraction output into a strict, pre-defined JSON schema before passing it downstream. **Consequences (testable):**

* If the extracted data fails JSON schema validation, the pipeline halts and returns a structured "Document Unreadable" error rather than passing malformed data to the reasoning agent.

### **4.2 The Conversational Oracle**

**Description:** The primary multi-turn chat interface where the Board President and Treasurer query the Fiduciary Watchdog. The Oracle routes intent, executes Deterministic Tooling, and synthesizes answers while strictly adhering to the Zero-LLM Token Arithmetic guardrail. Realizes UJ-2.

#### **FR-4: Intent Routing & Tool Execution**

When a user submits a query, the system must evaluate if the request requires factual ledger retrieval or financial calculation. **Consequences (testable):**

* If math or exact ledger data is required, the system explicitly delegates the task to a read-only SQL tool or Python code interpreter.  
* The reasoning LLM is blocked from attempting to predict or calculate numerical answers based solely on its context window.

#### **FR-5: Audit-Grade Transparency ("Show Your Work")**

When the Conversational Oracle answers a financial query using Deterministic Tooling, the UI must expose the verifiable evidence alongside the conversational text answer. Realizes UJ-2. **Consequences (testable):**

* The chat UI renders a structured data table of the retrieved ledger entries.  
* An expandable UI element allows the user to view the exact SQL query or Python snippet executed to generate the result, proving the math is deterministic.

### **4.3 Passive Anomaly Detection**

**Description:** The background Watchdog process that actively monitors newly ingested documents and cross-references them against historical ledger data to protect the board from fraud, errors, or delinquencies.

#### **FR-6: Vendor & Invoice Anomaly Detection**

The system automatically compares newly uploaded vendor invoices against historical payment data and vendor averages. Realizes UJ-1. **Consequences (testable):**

* Flags exact duplicates (matching amount and date) and fuzzy duplicates (e.g., similar invoice number with the exact same amount).  
* Detects when a routine vendor's invoice exceeds their trailing 6-month average by a predefined threshold (e.g., 20%).

#### **FR-7: Automated Dues Triangulation**

The system passively compares read-only bank deposit feeds

$$ASSUMPTION: Bank feeds are manually uploaded via CSV for the pilot$$

against the expected assessment roll to identify delinquencies. **Consequences (testable):**

* Identifies units with missed payments or partial payments without requiring manual reconciliation by the Treasurer.

#### **FR-8: Multi-Channel Alerting (Dashboard & Email)**

When an anomaly is detected (FR-6 or FR-7), the system must proactively notify the designated board members. **Consequences (testable):**

* Surfaces high-priority alerts in a dedicated "Watchdog Alerts" widget on the main web dashboard.  
* Dispatches a structured, automated email alert summarizing the anomaly to configured board members (e.g., Treasurer, President).

## **5\. Explicit Non-Goals**

* **Write-Access to Banking API:** The system will never execute, initiate, or approve payments on any banking rail, and holds no credential that would make this possible.  
* **External Ledger Mutation:** The system will not write to, alter, or delete records in any *external* system of record — a bank, QuickBooks, AppFolio, or a property-management platform. It reads what the board uploads and maintains its own analysis store; it never pushes changes back out. *(This is not a claim that the system performs no writes at all — it owns and writes its own database. See the Air-Gap glossary entry.)*  
* **Resident-Facing Portal:** The system will not provide any interface, chat bot, or login for standard condo residents to check their own dues.  
* **Tax/Legal Advice:** The Conversational Oracle will explicitly refuse to generate binding legal opinions, issue tax advice, or interpret state condo statutes (e.g., Florida HB 1021\) beyond retrieving saved board documents.

## **6\. Security Boundaries & Non-Functional Requirements (NFRs)**

### **6.1 Structural Air-Gap & Database Security**

* **NFR-1 (Role Separation by Pipeline Stage):** The system owns and writes its own database, but that capability is partitioned by stage rather than granted wholesale. The ingestion pipeline authenticates with a writer role; the LLM-driven query path authenticates with a dedicated **SELECT-only** role and can therefore never mutate data, regardless of what the model is induced to attempt. Neither role may be granted the other's capability. *(Revised from an earlier draft that described read-only roles against an external accounting database — under the uploads-only data plane no such database is connected. See ADR AD-4.)*  
* **NFR-1a (No Data Credentials in the LLM Runtime):** The Python agent service holds exactly one secret — the reasoning model's API key — and never a database credential, connection string, or storage key. It obtains every fact by calling the gateway's tool endpoints. *(See AD-3.)*  
* **NFR-2 (No External Write Tokens):** No API key with write permissions for a banking platform, payment processor, or external accounting system (e.g., QuickBooks, AppFolio) may exist in the environment variables, secret store, or CI configuration of any deploy unit. The air-gap is enforced by the absence of the credential, not by a scope setting.

### **6.2 LLM Routing & Prompt Guardrails**

* **NFR-3 (Zero-LLM Token Arithmetic):** Enforced structurally, not by instruction. Every numeric token in a rendered answer must match a value present in the tool result set for that turn; a pre-render validator rejects any unreferenced numeral and forces a retry. System-prompt directives may remain as defence in depth but carry no enforcement weight — a prompt is a request, and SM-1 claims 100%. *(Revised from a prompt-directive mechanism. See AD-7.)*  
* **NFR-4 (Model Requirements):** The reasoning model is bound by **capability, not by name**: it must support strict tool use and schema-validated structured outputs, because the parameterized query catalog's enforcement depends on both. A model lacking either is disqualified regardless of benchmark standing. The current binding is `claude-sonnet-5`; the model id is replaceable, the capability bar is not. *(Revised from a pin on Claude 3.5 Sonnet, which was retired in October 2025, and from a named-competitor exclusion that stated a vendor rather than a property. See AD-11.)*

### **6.3 Audit & Egress**

* **NFR-5 (Query Provenance):** Every natural language query translated into an SQL execution by the Conversational Oracle must be permanently logged alongside the user ID, timestamp, and exact SQL string generated, ensuring full auditability of the board's data access.

## **7\. MVP Scope (Pilot Phase)**

### **7.1 In Scope**

* Document ingestion (PDF, CSV, Excel, Image) via UI.  
* Dual-LLM extraction pipeline with rigid schema conformance.  
* Conversational Oracle with "Show Your Work" data tables.  
* Passive detection for invoice duplicates and billing spikes.  
* Dashboard and Email anomaly alerts.

### **7.2 Out of Scope**

* SMS Alerts `[NON-GOAL for MVP]`.  
* Direct API integrations with existing property management software (MVP relies on CSV/Excel uploads).

## **8\. Success Metrics**

* **SM-1 (Accuracy of Oracle):** 100% of mathematical queries executed by the Conversational Oracle are successfully delegated to Deterministic Tooling rather than hallucinated by the LLM. (Validates FR-4).  
* **SM-2 (Anomaly Catch Rate):** 100% of mathematically exact duplicate invoices uploaded during testing are flagged by the system. (Validates FR-6).  
* **SM-C1 (Counter-Metric \- Latency):** Do not optimize for sub-second chat response times if it compromises the execution of the full Dual-LLM extraction and SQL validation pipeline. Accuracy is strictly prioritized over conversational speed.

## **9\. Assumptions Index**

* `[ASSUMPTION]` from §4.3 (FR-7): Bank feeds are manually uploaded via CSV for the pilot. *The pilot will not rely on Plaid or direct bank API connections for deposit ingestion.*

